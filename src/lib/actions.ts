"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma, ProspectStage, KycStatus, PlanStatus } from "@prisma/client";
import { requireAdmin, requireSession } from "@/lib/auth";
import { IRT, liveSessionWhere } from "@/lib/irt";
import { prisma } from "@/lib/prisma";
import { formError, type FormState } from "@/lib/form-state";
import { panSchema, phoneShape, toE164 } from "@/lib/identifiers";
import { passwordProblem } from "@/lib/password-policy";
import { chapterHref, loadTrackProgress } from "@/lib/knowledge";
import { deleteObject, storageConfig } from "@/lib/storage";
import { errorsFromAdding } from "@/lib/question-bank";
import { PLAN_TRANSITIONS } from "@/lib/plan-status";

/** A form date ("YYYY-MM-DD"). An invalid one is a message, not a 500 (flags O12). */
const isDate = (value: string) => !Number.isNaN(Date.parse(value));
const formDate = (label: string) =>
  z
    .string()
    .refine(isDate, `${label}: enter a valid date`)
    .transform((value) => new Date(value));

const optionalDate = (label: string) =>
  z
    .string()
    .optional()
    .refine((value) => !value || isDate(value), `${label}: enter a valid date`)
    .transform((value) => (value ? new Date(value) : undefined));

const prospectSchema = z
  .object({
    name: z.string().min(2).max(120),
    ...phoneShape,
    source: z.enum(["REFERRAL", "WALK_IN", "EVENT", "ONLINE"]),
    stage: z.enum(["LEAD", "MEETING_HELD", "PLAN_SENT", "ONBOARDED", "DROPPED"]),
    notes: z.string().max(2000).default(""),
    firstContactDate: formDate("First contact date"),
    followUpDate: optionalDate("Follow-up date")
  })
  .transform(toE164);

const clientSchema = z
  .object({
    name: z.string().min(2).max(120),
    ...phoneShape,
    pan: panSchema,
    kycStatus: z.enum(["VERIFIED", "PENDING", "EXPIRED"]),
    aum: z.coerce.number().positive(),
    onboardingDate: formDate("Onboarding date")
  })
  .transform(toE164);

const prospectOnboardingSchema = z.object({
  prospectId: z.string(),
  pan: panSchema,
  kycStatus: z.enum(["VERIFIED", "PENDING", "EXPIRED"]),
  aum: z.coerce.number().positive(),
  onboardingDate: formDate("Onboarding date")
});

const planSchema = z.object({
  clientId: z.string(),
  planType: z.enum(["SIP", "LUMP_SUM", "ELSS", "MIXED"]),
  amount: z.coerce.number().positive(),
  frequency: z.enum(["MONTHLY", "QUARTERLY", "ONE_TIME"]),
  goal: z.enum(["RETIREMENT", "EDUCATION", "WEALTH", "TAX_SAVING", "OTHER"]),
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "ACTIVE", "CLOSED"]),
  notes: z.string().max(2000).default("")
});

const reviewSchema = z.object({
  clientId: z.string(),
  reviewDate: formDate("Review date"),
  currentAum: z.coerce.number().positive(),
  returns: z.coerce.number(),
  actions: z.string().min(5).max(2000),
  nextReviewDate: formDate("Next review date"),
  attachmentNote: z.string().max(500).optional()
});

const meetingSchema = z.object({
  /** Who the meeting was with: "prospect:<id>" or "client:<id>". */
  party: z.string().regex(/^(prospect|client):[^:]+$/, "Choose who the meeting was with"),
  summary: z.string().min(3).max(180),
  notes: z.string().max(2000).default(""),
  meetingDate: formDate("Meeting date"),
  followUpDate: optionalDate("Follow-up date")
});

const questionSchema = z.object({
  chapterId: z.string().min(1),
  content: z.string().min(10).max(500),
  optionA: z.string().min(1).max(300),
  optionB: z.string().min(1).max(300),
  optionC: z.string().min(1).max(300),
  optionD: z.string().min(1).max(300),
  correctKey: z.enum(["A", "B", "C", "D"]),
  explanation: z.string().min(10).max(1000),
  difficulty: z.coerce.number().min(-4).max(4).default(0),
  discrimination: z.coerce.number().min(0.25).max(3).default(1),
  // One default everywhere: 0.25, the blind-hit chance on four options (O16).
  guessing: z.coerce.number().min(0).max(0.5).default(0.25)
});

const userSchema = z.object({
  name: z.string().min(2).max(120),
  // Normalised before the format check, so a pasted " Name@Firm.com " is
  // accepted and stored the way sign-in looks it up (lowercased, trimmed).
  email: z.string().trim().toLowerCase().email(),
  password: z.string().superRefine((value, ctx) => {
    const problem = passwordProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  }),
  role: z.enum(["ADMIN", "ADVISOR"])
});

export async function createProspect(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const result = prospectSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) return formError(result.error);
  const parsed = result.data;
  if (await prisma.prospect.findUnique({ where: { phone: parsed.phone } })) {
    return { error: DUPLICATE.prospectPhone };
  }
  try {
    await prisma.prospect.create({
      data: { ...parsed, assignedToId: session.user.id }
    });
  } catch (error) {
    return duplicateError(error, { phone: DUPLICATE.prospectPhone });
  }
  await log(session.user.id, "CREATE", "Prospect", parsed.name);
  revalidatePath("/prospects");
  return done();
}

export async function updateProspectStage(formData: FormData) {
  const session = await requireSession();
  const id = z.string().parse(formData.get("id"));
  const stage = z.nativeEnum(ProspectStage).parse(formData.get("stage"));
  await prisma.prospect.update({
    where: { id, ...(session.user.role === "ADMIN" ? {} : { assignedToId: session.user.id }) },
    data: { stage }
  });
  await log(session.user.id, "UPDATE", "Prospect", `Stage changed to ${stage}`, id);
  revalidatePath("/prospects");
  revalidatePath("/dashboard");
}

export async function createClient(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const result = clientSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) return formError(result.error);
  const parsed = result.data;
  if (await prisma.client.findUnique({ where: { pan: parsed.pan } })) return { error: DUPLICATE.clientPan };
  if (await prisma.client.findUnique({ where: { phone: parsed.phone } })) return { error: DUPLICATE.clientPhone };
  try {
    await prisma.client.create({
      data: { ...parsed, aum: new Prisma.Decimal(parsed.aum), assignedToId: session.user.id }
    });
  } catch (error) {
    return duplicateError(error, { pan: DUPLICATE.clientPan, phone: DUPLICATE.clientPhone });
  }
  await log(session.user.id, "CREATE", "Client", parsed.name);
  revalidatePath("/clients");
  return done();
}

export async function onboardProspect(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const result = prospectOnboardingSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) return formError(result.error);
  const parsed = result.data;
  const prospect = await prisma.prospect.findFirst({
    where: { id: parsed.prospectId, ...(session.user.role === "ADMIN" ? {} : { assignedToId: session.user.id }) }
  });
  if (!prospect) return { error: "Prospect not found" };

  if (await prisma.client.findUnique({ where: { pan: parsed.pan } })) return { error: DUPLICATE.clientPan };
  if (await prisma.client.findUnique({ where: { phone: prospect.phone } })) {
    return { error: DUPLICATE.clientPhone };
  }

  let client;
  try {
    client = await prisma.$transaction(async (tx) => {
      const created = await tx.client.create({
        data: {
          name: prospect.name,
          phone: prospect.phone,
          pan: parsed.pan,
          kycStatus: parsed.kycStatus,
          aum: new Prisma.Decimal(parsed.aum),
          onboardingDate: parsed.onboardingDate,
          assignedToId: prospect.assignedToId
        }
      });
      await tx.prospect.update({
        where: { id: prospect.id },
        data: { stage: "ONBOARDED", followUpDate: null }
      });
      await tx.meetingLog.create({
        data: {
          kind: "CLIENT",
          summary: "Prospect onboarded as client",
          notes: `Converted from prospect record for ${prospect.name}.`,
          meetingDate: parsed.onboardingDate,
          ownerId: session.user.id,
          clientId: created.id
        }
      });
      return created;
    });
  } catch (error) {
    return duplicateError(error, { pan: DUPLICATE.clientPan, phone: DUPLICATE.clientPhone });
  }

  await log(session.user.id, "ONBOARD", "Prospect", `${prospect.name} converted to client`, client.id);
  revalidatePath("/prospects");
  revalidatePath("/clients");
  revalidatePath("/dashboard");
  return done();
}

export async function updateClientKyc(formData: FormData) {
  const session = await requireSession();
  const id = z.string().parse(formData.get("id"));
  const kycStatus = z.nativeEnum(KycStatus).parse(formData.get("kycStatus"));
  await prisma.client.update({
    where: { id, ...(session.user.role === "ADMIN" ? {} : { assignedToId: session.user.id }) },
    data: { kycStatus }
  });
  await log(session.user.id, "UPDATE", "Client", `KYC changed to ${kycStatus}`, id);
  revalidatePath("/clients");
}

export async function createPlan(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const result = planSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) return formError(result.error);
  const parsed = result.data;
  const client = await prisma.client.findFirst({
    where: { id: parsed.clientId, ...(session.user.role === "ADMIN" ? {} : { assignedToId: session.user.id }) }
  });
  if (!client) return { error: "Client not found" };
  const now = new Date();
  const plan = await prisma.investmentPlan.create({
    data: {
      ...parsed,
      amount: new Prisma.Decimal(parsed.amount),
      sentDate: ["SENT", "ACCEPTED", "ACTIVE"].includes(parsed.status) ? now : undefined,
      acceptedDate: ["ACCEPTED", "ACTIVE"].includes(parsed.status) ? now : undefined
    }
  });
  await log(session.user.id, "CREATE", "InvestmentPlan", `${parsed.planType} for ${client.name}`, plan.id);
  revalidatePath("/plans");
  revalidatePath("/dashboard");
  return done();
}

export async function updatePlanStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const id = z.string().parse(formData.get("id"));
  const status = z.nativeEnum(PlanStatus).parse(formData.get("status"));
  const plan = await prisma.investmentPlan.findFirst({
    where: { id, client: session.user.role === "ADMIN" ? {} : { assignedToId: session.user.id } }
  });
  if (!plan) return { error: "Plan not found" };
  if (status === plan.status) return done();
  // Reachable from a page left open while the plan changed elsewhere.
  if (!PLAN_TRANSITIONS[plan.status].includes(status)) {
    return {
      error: `This plan is now ${plan.status.toLowerCase()} and cannot become ${status.toLowerCase()}; reload the page`
    };
  }
  const now = new Date();
  // Conditional on the status just checked, so two changes at once cannot
  // both pass the check.
  const { count } = await prisma.investmentPlan.updateMany({
    where: { id, status: plan.status },
    data: {
      status,
      // Pulled back to draft: it is no longer sent.
      sentDate: status === "DRAFT" ? null : status === "SENT" && !plan.sentDate ? now : undefined,
      acceptedDate: (status === "ACCEPTED" || status === "ACTIVE") && !plan.acceptedDate ? now : undefined
    }
  });
  if (count === 0) return { error: "This plan was changed elsewhere; reload and try again" };
  await log(session.user.id, "UPDATE", "InvestmentPlan", `Status changed from ${plan.status} to ${status}`, id);
  revalidatePath("/plans");
  revalidatePath("/dashboard");
  return done();
}

export async function createReview(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const result = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) return formError(result.error);
  const parsed = result.data;
  const client = await prisma.client.findFirst({
    where: { id: parsed.clientId, ...(session.user.role === "ADMIN" ? {} : { assignedToId: session.user.id }) }
  });
  if (!client) return { error: "Client not found" };
  const review = await prisma.$transaction(async (tx) => {
    const created = await tx.portfolioReview.create({
      data: {
        ...parsed,
        currentAum: new Prisma.Decimal(parsed.currentAum),
        returns: new Prisma.Decimal(parsed.returns)
      }
    });
    await tx.client.update({
      where: { id: client.id },
      data: { aum: new Prisma.Decimal(parsed.currentAum) }
    });
    return created;
  });
  await log(session.user.id, "CREATE", "PortfolioReview", `Review for ${client.name}; AUM synced`, review.id);
  revalidatePath("/reviews");
  revalidatePath("/clients");
  revalidatePath("/dashboard");
  return done();
}

export async function createMeeting(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const result = meetingSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) return formError(result.error);
  const parsed = result.data;
  const [type, id] = parsed.party.split(":");
  const where = { id, ...(session.user.role === "ADMIN" ? {} : { assignedToId: session.user.id }) };
  if (
    type === "prospect" ? !(await prisma.prospect.findFirst({ where })) : !(await prisma.client.findFirst({ where }))
  ) {
    return { error: type === "prospect" ? "Prospect not found" : "Client not found" };
  }
  const meeting = await prisma.meetingLog.create({
    data: {
      kind: type === "prospect" ? "PROSPECT" : "CLIENT",
      summary: parsed.summary,
      notes: parsed.notes,
      meetingDate: parsed.meetingDate,
      followUpDate: parsed.followUpDate,
      ownerId: session.user.id,
      prospectId: type === "prospect" ? id : undefined,
      clientId: type === "client" ? id : undefined
    }
  });
  await log(session.user.id, "CREATE", "MeetingLog", parsed.summary, meeting.id);
  revalidatePath("/dashboard");
  revalidatePath("/prospects");
  revalidatePath("/clients");
  revalidatePath("/reviews");
  return done();
}

/**
 * Adds one question from the admin page. Held to the same checks as an
 * import: the question's own, and the bank problems it would introduce in
 * its topic (errorsFromAdding). The first problem is shown on the form.
 */
export async function createQuestionItem(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdmin();
  const result = questionSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) return formError(result.error);
  const parsed = result.data;
  // The chapter decides the topic, so the two cannot disagree.
  const chapter = await prisma.chapter.findUnique({
    where: { id: parsed.chapterId },
    include: { topic: { select: { title: true, slug: true } } }
  });
  if (!chapter) return { error: "Chapter not found" };

  const options = (["A", "B", "C", "D"] as const).map((key) => ({ key, text: parsed[`option${key}`] }));
  const added = {
    topic: chapter.topic.slug,
    chapterSlug: chapter.slug,
    content: parsed.content,
    options,
    correctKey: parsed.correctKey,
    explanation: parsed.explanation,
    difficulty: parsed.difficulty,
    discrimination: parsed.discrimination,
    guessing: parsed.guessing
  };
  const existing = await prisma.questionItem.findMany({
    where: { topicId: chapter.topicId, isActive: true },
    include: { chapter: { select: { slug: true } } }
  });
  const [problem] = errorsFromAdding(
    existing.map((row) => ({
      topic: chapter.topic.slug,
      chapterSlug: row.chapter.slug,
      content: row.content,
      options: row.options as { key: string; text: string }[],
      correctKey: row.correctKey,
      explanation: row.explanation,
      difficulty: row.difficulty,
      discrimination: row.discrimination,
      guessing: row.guessing
    })),
    added
  );
  if (problem) return { error: problem.message.charAt(0).toUpperCase() + problem.message.slice(1) };

  const question = await prisma.questionItem.create({
    data: {
      topicId: chapter.topicId,
      chapterId: chapter.id,
      content: parsed.content,
      options,
      correctKey: parsed.correctKey,
      explanation: parsed.explanation,
      difficulty: parsed.difficulty,
      discrimination: parsed.discrimination,
      guessing: parsed.guessing,
      createdById: session.user.id
    }
  });
  await log(session.user.id, "CREATE", "QuestionItem", `${chapter.topic.title} item added`, question.id);
  revalidatePath("/admin");
  revalidatePath("/certify");
  revalidatePath(`/certify/${chapter.topicId}`);
  return done();
}

/**
 * Marks a chapter complete for the signed-in user: the tick on the chapter.
 *
 * Checks the chapter is open to them. The page only shows the button on an
 * open chapter, but a form post can name any chapter id.
 */
export async function markChapterComplete(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const chapterId = z.string().min(1).parse(formData.get("chapterId"));
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: { topic: { include: { module: { include: { track: true } } } } }
  });
  // Reachable from a page left open while the chapter was unpublished.
  if (!chapter || !chapter.isPublished) return { error: "This chapter is no longer published; reload the page" };
  const { topic } = chapter;
  const { track } = topic.module;

  const standing = await loadTrackProgress({ id: track.id }, session.user);
  const state = standing?.progress
    .find((row) => row.id === topic.id)
    ?.chapters.find((row) => row.id === chapterId)?.state;
  if (state !== "open" && state !== "complete") return { error: "This chapter is locked; reload the page" };

  await prisma.chapterCompletion.upsert({
    where: { userId_chapterId: { userId: session.user.id, chapterId } },
    create: { userId: session.user.id, chapterId },
    update: {}
  });
  revalidatePath(chapterHref(track.slug, topic.module.slug, topic.slug, chapter.slug));
  revalidatePath(`/knowledge/${track.slug}`);
  return done();
}

// --- Knowledge editor (admin) -------------------------------------------------

const slugField = z
  .string()
  .trim()
  .max(60)
  .regex(/^([a-z0-9]+(-[a-z0-9]+)*)?$/, "Slug: lowercase letters, digits and single hyphens only")
  .default("");

const titledSchema = z.object({
  title: z.string().trim().min(2).max(120),
  slug: slugField,
  description: z.string().trim().max(1000).default("")
});

const chapterSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(2).max(120),
  slug: slugField,
  body: z.string().max(200_000),
  isPublished: z.literal("on").optional()
});

/** Blank slug fields fall back to one made from the title. */
function slugOr(slug: string, title: string) {
  return (
    slug ||
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) ||
    "untitled"
  );
}

/** Every page that shows track content, trainee and admin side. */
function revalidateKnowledge() {
  revalidatePath("/knowledge", "layout");
  revalidatePath("/admin/knowledge", "layout");
}

/** A slug or order clash, or a row gone missing, worded for the editor. */
function knowledgeConflict(error: unknown): FormState {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
  if (error.code === "P2025") return { error: "Not found; it may have been changed elsewhere. Reload the page." };
  if (error.code !== "P2002") throw error;
  return String(error.meta?.target ?? "").includes("slug")
    ? { error: "That slug is already used here; choose another" }
    : { error: "Someone else changed this list at the same time; reload and try again" };
}

export async function saveTrack(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdmin();
  const id = z
    .string()
    .optional()
    .parse(formData.get("id") || undefined);
  const result = titledSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) return formError(result.error);
  const { title, description } = result.data;
  const slug = slugOr(result.data.slug, title);
  const isActive = formData.get("isActive") === "on";
  try {
    const track = id
      ? await prisma.track.update({ where: { id }, data: { title, slug, description, isActive } })
      : await prisma.track.create({
          data: { title, slug, description, isActive, order: await nextOrder("track", {}) }
        });
    await log(session.user.id, id ? "UPDATE" : "CREATE", "Track", `${track.title} saved`, track.id);
  } catch (error) {
    return knowledgeConflict(error);
  }
  revalidateKnowledge();
  return done();
}

export async function saveTopic(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdmin();
  const id = z
    .string()
    .optional()
    .parse(formData.get("id") || undefined);
  const result = titledSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) return formError(result.error);
  const { title, description } = result.data;
  const slug = slugOr(result.data.slug, title);
  const isPublished = formData.get("isPublished") === "on";
  try {
    let saved;
    if (id) {
      saved = await prisma.topic.update({ where: { id }, data: { title, slug, description, isPublished } });
    } else {
      const moduleId = z.string().min(1).parse(formData.get("moduleId"));
      if (!(await prisma.module.findUnique({ where: { id: moduleId } }))) return { error: "Module not found" };
      saved = await prisma.topic.create({
        data: { moduleId, title, slug, description, isPublished, order: await nextOrder("topic", { moduleId }) }
      });
    }
    await log(
      session.user.id,
      id ? "UPDATE" : "CREATE",
      "Topic",
      `${saved.title} saved (${isPublished ? "published" : "unpublished"})`,
      saved.id
    );
  } catch (error) {
    return knowledgeConflict(error);
  }
  revalidateKnowledge();
  return done();
}

/**
 * Deletes a topic and everything in it: chapters (with completions and file
 * records), questions, every test attempt on it (with answers and integrity
 * events) and its badges. Irreversible, so the admin types the topic's slug
 * to confirm (owner decision 2026-10-17: production holds fixtures only).
 *
 * One transaction: either all of it goes or none of it does. Uploaded files
 * are removed from the bucket afterwards; a file that fails to delete is only
 * an orphan in private storage, and the audit entry says so.
 */
export async function deleteTopic(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("id"));
  const typed = z
    .string()
    .trim()
    .parse(formData.get("confirm") ?? "");
  const topic = await prisma.topic.findUnique({ where: { id }, select: { title: true, slug: true } });
  if (!topic) return { error: "Not found; it may have been deleted already. Reload the page." };
  if (typed !== topic.slug) return { error: `Type ${topic.slug} to confirm` };

  const removed = await prisma.$transaction(async (tx) => {
    const sessions = (await tx.testSession.findMany({ where: { topicId: id }, select: { id: true } })).map(
      (row) => row.id
    );
    const questions = (await tx.questionItem.findMany({ where: { topicId: id }, select: { id: true } })).map(
      (row) => row.id
    );
    const assets = await tx.asset.findMany({ where: { chapter: { topicId: id } }, select: { key: true } });

    const badges = await tx.certification.deleteMany({
      where: { OR: [{ topicId: id }, { sessionId: { in: sessions } }] }
    });
    // Answers and integrity events go with their attempts (cascade). Answers
    // to these questions inside any other attempt go too, or the questions
    // could not be deleted.
    await tx.responseLog.deleteMany({ where: { questionId: { in: questions } } });
    const attempts = await tx.testSession.deleteMany({ where: { id: { in: sessions } } });
    const questionCount = await tx.questionItem.deleteMany({ where: { id: { in: questions } } });
    await tx.asset.deleteMany({ where: { chapter: { topicId: id } } });
    const chapters = await tx.chapter.deleteMany({ where: { topicId: id } });
    await tx.topic.delete({ where: { id } });
    return {
      chapters: chapters.count,
      questions: questionCount.count,
      attempts: attempts.count,
      badges: badges.count,
      keys: assets.map((row) => row.key)
    };
  });

  const config = storageConfig();
  const results = config ? await Promise.allSettled(removed.keys.map((key) => deleteObject(config, key))) : [];
  const fileFailures = config
    ? results.filter((result) => result.status === "rejected" || !result.value.ok).length
    : removed.keys.length;

  await log(
    session.user.id,
    "DELETE",
    "Topic",
    `${topic.title} deleted: ${removed.chapters} chapters, ${removed.questions} questions, ` +
      `${removed.attempts} test attempts, ${removed.badges} badges, ${removed.keys.length} files` +
      (fileFailures ? ` (${fileFailures} files left in storage)` : ""),
    id
  );
  revalidateKnowledge();
  revalidatePath("/certify");
  revalidatePath("/admin");
  return done();
}

/** Deletes a module, only once it has no topics left. */
export async function deleteModule(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("id"));
  const trainingModule = await prisma.module.findUnique({
    where: { id },
    select: { title: true, _count: { select: { topics: true } } }
  });
  if (!trainingModule) return { error: "Not found; it may have been deleted already. Reload the page." };
  if (trainingModule._count.topics > 0) return { error: "Delete or move this module's topics first" };
  try {
    await prisma.module.delete({ where: { id } });
  } catch (error) {
    // A topic added since the check above: the foreign key refuses.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return { error: "Delete or move this module's topics first" };
    }
    return knowledgeConflict(error);
  }
  await log(session.user.id, "DELETE", "Module", `${trainingModule.title} deleted`, id);
  revalidateKnowledge();
  return done();
}

/** New chapters start unpublished, so trainees never see a half-written one. */
export async function createChapter(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdmin();
  const topicId = z.string().min(1).parse(formData.get("topicId"));
  const result = titledSchema.omit({ description: true }).safeParse(Object.fromEntries(formData));
  if (!result.success) return formError(result.error);
  if (!(await prisma.topic.findUnique({ where: { id: topicId } }))) return { error: "Topic not found" };
  const { title } = result.data;
  try {
    const chapter = await prisma.chapter.create({
      data: { topicId, title, slug: slugOr(result.data.slug, title), order: await nextOrder("chapter", { topicId }) }
    });
    await log(session.user.id, "CREATE", "Chapter", `${chapter.title} created`, chapter.id);
  } catch (error) {
    return knowledgeConflict(error);
  }
  revalidateKnowledge();
  return done();
}

export async function saveChapter(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdmin();
  const result = chapterSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) return formError(result.error);
  const { id, title, body } = result.data;
  const isPublished = result.data.isPublished === "on";
  // Unpublishing takes the chapter's questions out of tests, including one
  // on a candidate's screen (flags D11): wait until none is being sat.
  if (!isPublished) {
    const current = await prisma.chapter.findUnique({ where: { id }, select: { isPublished: true, topicId: true } });
    if (current?.isPublished) {
      const live = await prisma.testSession.count({ where: { topicId: current.topicId, ...liveSessionWhere() } });
      if (live) {
        return {
          error:
            `${live} test${live === 1 ? " is" : "s are"} being taken on this topic right now. ` +
            `Unpublish in up to ${IRT.timeLimitMinutes} minutes, once ${live === 1 ? "it ends" : "they end"}.`
        };
      }
    }
  }
  try {
    const chapter = await prisma.chapter.update({
      where: { id },
      data: { title, slug: slugOr(result.data.slug, title), body, isPublished }
    });
    await log(
      session.user.id,
      "UPDATE",
      "Chapter",
      `${chapter.title} saved (${isPublished ? "published" : "draft"})`,
      chapter.id
    );
  } catch (error) {
    return knowledgeConflict(error);
  }
  revalidateKnowledge();
  return done();
}

/**
 * Swaps an item with its neighbour. `order` is unique within the parent, so
 * the moving row parks at -1 while the neighbour takes its place.
 */
export async function moveKnowledgeItem(formData: FormData) {
  const session = await requireAdmin();
  const kind = z.enum(["track", "topic", "chapter"]).parse(formData.get("kind"));
  const id = z.string().min(1).parse(formData.get("id"));
  const direction = z.enum(["up", "down"]).parse(formData.get("direction"));

  await prisma.$transaction(async (tx) => {
    const model = tx[kind] as unknown as OrderedModel;
    const row = await model.findUnique({ where: { id } });
    if (!row) throw new Error("Not found");
    const parent = kind === "topic" ? { moduleId: row.moduleId } : kind === "chapter" ? { topicId: row.topicId } : {};
    const other = await model.findFirst({
      where: { ...parent, order: direction === "up" ? { lt: row.order } : { gt: row.order } },
      orderBy: { order: direction === "up" ? "desc" : "asc" }
    });
    if (!other) return;
    await model.update({ where: { id: row.id }, data: { order: -1 } });
    await model.update({ where: { id: other.id }, data: { order: row.order } });
    await model.update({ where: { id: row.id }, data: { order: other.order } });
  });

  await log(session.user.id, "UPDATE", kind[0].toUpperCase() + kind.slice(1), `Moved ${direction}`, id);
  revalidateKnowledge();
}

/** Track, Topic and Chapter share id, order and a parent link; enough for reordering. */
type OrderedRow = { id: string; order: number; moduleId?: string; topicId?: string };
type OrderedModel = {
  findUnique(args: object): Promise<OrderedRow | null>;
  findFirst(args: object): Promise<OrderedRow | null>;
  update(args: object): Promise<unknown>;
  aggregate(args: object): Promise<{ _max: { order: number | null } }>;
};

async function nextOrder(kind: "track" | "topic" | "chapter", where: { moduleId?: string; topicId?: string }) {
  const model = prisma[kind] as unknown as OrderedModel;
  const max = await model.aggregate({ where, _max: { order: true } });
  return (max._max.order ?? 0) + 1;
}

export async function createUser(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdmin();
  const result = userSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) return formError(result.error);
  const parsed = result.data;
  const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (existing) return { error: DUPLICATE.userEmail };

  let user;
  try {
    user = await prisma.user.create({
      data: {
        name: parsed.name,
        email: parsed.email,
        role: parsed.role,
        passwordHash: await bcrypt.hash(parsed.password, 12)
      }
    });
  } catch (error) {
    return duplicateError(error, { email: DUPLICATE.userEmail });
  }
  await log(session.user.id, "CREATE", "User", `${user.name} added`, user.id);
  revalidatePath("/admin");
  return done();
}

export async function updateUserActive(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdmin();
  const id = z.string().parse(formData.get("id"));
  const isActive = z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .parse(formData.get("isActive"));
  if (id === session.user.id && !isActive) return { error: "You cannot deactivate your own account" };

  const user = await prisma.user.update({
    where: { id },
    data: { isActive }
  });
  await log(session.user.id, "UPDATE", "User", `${user.name} ${isActive ? "activated" : "deactivated"}`, user.id);
  revalidatePath("/admin");
  return done();
}

export async function signInRedirect() {
  redirect("/dashboard");
}

async function log(actorId: string, action: string, entity: string, summary: string, entityId?: string) {
  await prisma.auditLog.create({ data: { actorId, action, entity, summary, entityId } });
}

const DUPLICATE = {
  prospectPhone: "A prospect with this mobile number already exists",
  clientPhone: "A client with this mobile number already exists",
  clientPan: "A client with this PAN already exists",
  userEmail: "A user with this email already exists"
};

function done(): FormState {
  return { ok: Date.now() };
}

/**
 * Turns a unique-constraint race (two people saving the same PAN, mobile or
 * email at once, after both passed the lookup) into the same message the lookup gives.
 */
function duplicateError(error: unknown, messages: Partial<Record<"pan" | "phone" | "email", string>>): FormState {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
  const target = String(error.meta?.target ?? "");
  const field = (["pan", "phone", "email"] as const).find((name) => target.includes(name) && messages[name]);
  return { error: field ? messages[field] : "This record already exists" };
}
