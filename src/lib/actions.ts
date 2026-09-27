"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma, ProspectStage, KycStatus, PlanStatus } from "@prisma/client";
import { requireAdmin, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { FormState } from "@/lib/form-state";
import { panSchema, phoneShape, toE164 } from "@/lib/identifiers";
import { chapterHref, loadTrackProgress } from "@/lib/knowledge";

const optionalDate = z
  .string()
  .optional()
  .transform((value) => (value ? new Date(value) : undefined));

const prospectSchema = z
  .object({
    name: z.string().min(2).max(120),
    ...phoneShape,
    source: z.enum(["REFERRAL", "WALK_IN", "EVENT", "ONLINE"]),
    stage: z.enum(["LEAD", "MEETING_HELD", "PLAN_SENT", "ONBOARDED", "DROPPED"]),
    notes: z.string().max(2000).default(""),
    firstContactDate: z.string().transform((value) => new Date(value)),
    followUpDate: optionalDate
  })
  .transform(toE164);

const clientSchema = z
  .object({
    name: z.string().min(2).max(120),
    ...phoneShape,
    pan: panSchema,
    kycStatus: z.enum(["VERIFIED", "PENDING", "EXPIRED"]),
    aum: z.coerce.number().positive(),
    onboardingDate: z.string().transform((value) => new Date(value))
  })
  .transform(toE164);

const prospectOnboardingSchema = z.object({
  prospectId: z.string(),
  pan: panSchema,
  kycStatus: z.enum(["VERIFIED", "PENDING", "EXPIRED"]),
  aum: z.coerce.number().positive(),
  onboardingDate: z.string().transform((value) => new Date(value))
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
  reviewDate: z.string().transform((value) => new Date(value)),
  currentAum: z.coerce.number().positive(),
  returns: z.coerce.number(),
  actions: z.string().min(5).max(2000),
  nextReviewDate: z.string().transform((value) => new Date(value)),
  attachmentNote: z.string().max(500).optional()
});

const meetingSchema = z.object({
  /** Who the meeting was with: "prospect:<id>" or "client:<id>". */
  party: z.string().regex(/^(prospect|client):[^:]+$/, "Choose who the meeting was with"),
  summary: z.string().min(3).max(180),
  notes: z.string().max(2000).default(""),
  meetingDate: z.string().transform((value) => new Date(value)),
  followUpDate: optionalDate
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
  guessing: z.coerce.number().min(0).max(0.5).default(0.2)
});

const userSchema = z.object({
  name: z.string().min(2).max(120),
  email: z
    .string()
    .email()
    .transform((value) => value.toLowerCase().trim()),
  password: z.string().min(8).max(128),
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

export async function updatePlanStatus(formData: FormData) {
  const session = await requireSession();
  const id = z.string().parse(formData.get("id"));
  const status = z.nativeEnum(PlanStatus).parse(formData.get("status"));
  const plan = await prisma.investmentPlan.findFirst({
    where: { id, client: session.user.role === "ADMIN" ? {} : { assignedToId: session.user.id } }
  });
  if (!plan) throw new Error("Plan not found");
  const now = new Date();
  await prisma.investmentPlan.update({
    where: { id },
    data: {
      status,
      sentDate: status === "SENT" && !plan.sentDate ? now : undefined,
      acceptedDate: (status === "ACCEPTED" || status === "ACTIVE") && !plan.acceptedDate ? now : undefined
    }
  });
  await log(session.user.id, "UPDATE", "InvestmentPlan", `Status changed to ${status}`, id);
  revalidatePath("/plans");
  revalidatePath("/dashboard");
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

export async function createQuestionItem(formData: FormData) {
  const session = await requireAdmin();
  const parsed = questionSchema.parse(Object.fromEntries(formData));
  // The chapter decides the module, so the two cannot disagree.
  const chapter = await prisma.chapter.findUnique({
    where: { id: parsed.chapterId },
    include: { module: { select: { title: true } } }
  });
  if (!chapter) throw new Error("Chapter not found");

  const question = await prisma.questionItem.create({
    data: {
      moduleId: chapter.moduleId,
      chapterId: chapter.id,
      content: parsed.content,
      options: [
        { key: "A", text: parsed.optionA },
        { key: "B", text: parsed.optionB },
        { key: "C", text: parsed.optionC },
        { key: "D", text: parsed.optionD }
      ],
      correctKey: parsed.correctKey,
      explanation: parsed.explanation,
      difficulty: parsed.difficulty,
      discrimination: parsed.discrimination,
      guessing: parsed.guessing,
      createdById: session.user.id
    }
  });
  await log(session.user.id, "CREATE", "QuestionItem", `${chapter.module.title} item added`, question.id);
  revalidatePath("/admin");
  revalidatePath("/certify");
  revalidatePath(`/certify/${chapter.moduleId}`);
}

/**
 * Marks a chapter complete for the signed-in user: the tick on the chapter.
 *
 * Checks the chapter is open to them. The page only shows the button on an
 * open chapter, but a form post can name any chapter id.
 */
export async function markChapterComplete(formData: FormData) {
  const session = await requireSession();
  const chapterId = z.string().min(1).parse(formData.get("chapterId"));
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: { module: { include: { track: true } } }
  });
  if (!chapter || !chapter.isPublished) throw new Error("Chapter not found");

  const standing = await loadTrackProgress({ id: chapter.module.trackId }, session.user);
  const state = standing?.progress
    .find((module) => module.id === chapter.moduleId)
    ?.chapters.find((row) => row.id === chapterId)?.state;
  if (state !== "open" && state !== "complete") throw new Error("This chapter is locked");

  await prisma.chapterCompletion.upsert({
    where: { userId_chapterId: { userId: session.user.id, chapterId } },
    create: { userId: session.user.id, chapterId },
    update: {}
  });
  revalidatePath(chapterHref(chapter.module.track.slug, chapter.module.slug, chapter.slug));
  revalidatePath(`/knowledge/${chapter.module.track.slug}`);
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

export async function saveModule(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdmin();
  const id = z
    .string()
    .optional()
    .parse(formData.get("id") || undefined);
  const result = titledSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) return formError(result.error);
  const { title, description } = result.data;
  const slug = slugOr(result.data.slug, title);
  try {
    let saved;
    if (id) {
      saved = await prisma.module.update({ where: { id }, data: { title, slug, description } });
    } else {
      const trackId = z.string().min(1).parse(formData.get("trackId"));
      if (!(await prisma.track.findUnique({ where: { id: trackId } }))) return { error: "Track not found" };
      saved = await prisma.module.create({
        data: { trackId, title, slug, description, order: await nextOrder("module", { trackId }) }
      });
    }
    await log(session.user.id, id ? "UPDATE" : "CREATE", "Module", `${saved.title} saved`, saved.id);
  } catch (error) {
    return knowledgeConflict(error);
  }
  revalidateKnowledge();
  return done();
}

/** New chapters start unpublished, so trainees never see a half-written one. */
export async function createChapter(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireAdmin();
  const moduleId = z.string().min(1).parse(formData.get("moduleId"));
  const result = titledSchema.omit({ description: true }).safeParse(Object.fromEntries(formData));
  if (!result.success) return formError(result.error);
  if (!(await prisma.module.findUnique({ where: { id: moduleId } }))) return { error: "Module not found" };
  const { title } = result.data;
  try {
    const chapter = await prisma.chapter.create({
      data: { moduleId, title, slug: slugOr(result.data.slug, title), order: await nextOrder("chapter", { moduleId }) }
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
  const kind = z.enum(["track", "module", "chapter"]).parse(formData.get("kind"));
  const id = z.string().min(1).parse(formData.get("id"));
  const direction = z.enum(["up", "down"]).parse(formData.get("direction"));

  await prisma.$transaction(async (tx) => {
    const model = tx[kind] as unknown as OrderedModel;
    const row = await model.findUnique({ where: { id } });
    if (!row) throw new Error("Not found");
    const parent = kind === "module" ? { trackId: row.trackId } : kind === "chapter" ? { moduleId: row.moduleId } : {};
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

/** Track, Module and Chapter share id, order and a parent link; enough for reordering. */
type OrderedRow = { id: string; order: number; trackId?: string; moduleId?: string };
type OrderedModel = {
  findUnique(args: object): Promise<OrderedRow | null>;
  findFirst(args: object): Promise<OrderedRow | null>;
  update(args: object): Promise<unknown>;
  aggregate(args: object): Promise<{ _max: { order: number | null } }>;
};

async function nextOrder(kind: "track" | "module" | "chapter", where: { trackId?: string; moduleId?: string }) {
  const model = prisma[kind] as unknown as OrderedModel;
  const max = await model.aggregate({ where, _max: { order: true } });
  return (max._max.order ?? 0) + 1;
}

export async function createUser(formData: FormData) {
  const session = await requireAdmin();
  const parsed = userSchema.parse(Object.fromEntries(formData));
  const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (existing) throw new Error("A user with this email already exists");

  const user = await prisma.user.create({
    data: {
      name: parsed.name,
      email: parsed.email,
      role: parsed.role,
      passwordHash: await bcrypt.hash(parsed.password, 12)
    }
  });
  await log(session.user.id, "CREATE", "User", `${user.name} added`, user.id);
  revalidatePath("/admin");
}

export async function updateUserActive(formData: FormData) {
  const session = await requireAdmin();
  const id = z.string().parse(formData.get("id"));
  const isActive = z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .parse(formData.get("isActive"));
  if (id === session.user.id && !isActive) throw new Error("You cannot deactivate your own account");

  const user = await prisma.user.update({
    where: { id },
    data: { isActive }
  });
  await log(session.user.id, "UPDATE", "User", `${user.name} ${isActive ? "activated" : "deactivated"}`, user.id);
  revalidatePath("/admin");
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
  clientPan: "A client with this PAN already exists"
};

function done(): FormState {
  return { ok: Date.now() };
}

/** The first validation problem, worded for the person filling in the form. */
function formError(error: z.ZodError): FormState {
  const issue = error.issues[0];
  // Custom and pattern messages (PAN, mobile) are written as full sentences already.
  if (!issue || issue.code === "custom" || issue.code === "invalid_string") return { error: issue?.message };
  const field = String(issue.path[0] ?? "");
  const label = field.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  return { error: label ? `${label}: ${issue.message}` : issue.message };
}

/**
 * Turns a unique-constraint race (two people saving the same PAN or mobile at
 * once, after both passed the lookup) into the same message the lookup gives.
 */
function duplicateError(error: unknown, messages: Partial<Record<"pan" | "phone", string>>): FormState {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
  const target = String(error.meta?.target ?? "");
  const field = (["pan", "phone"] as const).find((name) => target.includes(name) && messages[name]);
  return { error: field ? messages[field] : "This record already exists" };
}
