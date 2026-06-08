"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma, ProspectStage, KycStatus, PlanStatus } from "@prisma/client";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const optionalDate = z.string().optional().transform((value) => (value ? new Date(value) : undefined));

const prospectSchema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(8).max(20),
  source: z.enum(["REFERRAL", "WALK_IN", "EVENT", "ONLINE"]),
  stage: z.enum(["LEAD", "MEETING_HELD", "PLAN_SENT", "ONBOARDED", "DROPPED"]),
  notes: z.string().max(2000).default(""),
  firstContactDate: z.string().transform((value) => new Date(value)),
  followUpDate: optionalDate
});

const clientSchema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(8).max(20),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/),
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
  kind: z.enum(["PROSPECT", "CLIENT", "PLAN", "REVIEW"]),
  prospectId: z.string().optional(),
  clientId: z.string().optional(),
  summary: z.string().min(3).max(180),
  notes: z.string().max(2000).default(""),
  meetingDate: z.string().transform((value) => new Date(value)),
  followUpDate: optionalDate
});

export async function createProspect(formData: FormData) {
  const session = await requireSession();
  const parsed = prospectSchema.parse(Object.fromEntries(formData));
  await prisma.prospect.create({
    data: { ...parsed, assignedToId: session.user.id }
  });
  await log(session.user.id, "CREATE", "Prospect", parsed.name);
  revalidatePath("/prospects");
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

export async function createClient(formData: FormData) {
  const session = await requireSession();
  const parsed = clientSchema.parse(Object.fromEntries(formData));
  await prisma.client.create({
    data: { ...parsed, aum: new Prisma.Decimal(parsed.aum), assignedToId: session.user.id }
  });
  await log(session.user.id, "CREATE", "Client", parsed.name);
  revalidatePath("/clients");
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

export async function createPlan(formData: FormData) {
  const session = await requireSession();
  const parsed = planSchema.parse(Object.fromEntries(formData));
  const client = await prisma.client.findFirst({
    where: { id: parsed.clientId, ...(session.user.role === "ADMIN" ? {} : { assignedToId: session.user.id }) }
  });
  if (!client) throw new Error("Client not found");
  await prisma.investmentPlan.create({
    data: { ...parsed, amount: new Prisma.Decimal(parsed.amount), sentDate: parsed.status === "SENT" ? new Date() : undefined }
  });
  await log(session.user.id, "CREATE", "InvestmentPlan", `${parsed.planType} for ${client.name}`);
  revalidatePath("/plans");
}

export async function updatePlanStatus(formData: FormData) {
  const session = await requireSession();
  const id = z.string().parse(formData.get("id"));
  const status = z.nativeEnum(PlanStatus).parse(formData.get("status"));
  const plan = await prisma.investmentPlan.findFirst({
    where: { id, client: session.user.role === "ADMIN" ? {} : { assignedToId: session.user.id } }
  });
  if (!plan) throw new Error("Plan not found");
  await prisma.investmentPlan.update({
    where: { id },
    data: { status, acceptedDate: status === "ACCEPTED" || status === "ACTIVE" ? new Date() : undefined }
  });
  await log(session.user.id, "UPDATE", "InvestmentPlan", `Status changed to ${status}`, id);
  revalidatePath("/plans");
}

export async function createReview(formData: FormData) {
  const session = await requireSession();
  const parsed = reviewSchema.parse(Object.fromEntries(formData));
  const client = await prisma.client.findFirst({
    where: { id: parsed.clientId, ...(session.user.role === "ADMIN" ? {} : { assignedToId: session.user.id }) }
  });
  if (!client) throw new Error("Client not found");
  await prisma.portfolioReview.create({
    data: {
      ...parsed,
      currentAum: new Prisma.Decimal(parsed.currentAum),
      returns: new Prisma.Decimal(parsed.returns)
    }
  });
  await log(session.user.id, "CREATE", "PortfolioReview", `Review for ${client.name}`);
  revalidatePath("/reviews");
}

export async function createMeeting(formData: FormData) {
  const session = await requireSession();
  const parsed = meetingSchema.parse(Object.fromEntries(formData));
  await prisma.meetingLog.create({
    data: {
      kind: parsed.kind,
      summary: parsed.summary,
      notes: parsed.notes,
      meetingDate: parsed.meetingDate,
      followUpDate: parsed.followUpDate,
      ownerId: session.user.id,
      prospectId: parsed.prospectId || undefined,
      clientId: parsed.clientId || undefined
    }
  });
  await log(session.user.id, "CREATE", "MeetingLog", parsed.summary);
  revalidatePath("/dashboard");
  revalidatePath("/prospects");
  revalidatePath("/clients");
}

export async function signInRedirect() {
  redirect("/dashboard");
}

async function log(actorId: string, action: string, entity: string, summary: string, entityId?: string) {
  await prisma.auditLog.create({ data: { actorId, action, entity, summary, entityId } });
}
