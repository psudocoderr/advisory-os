import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { IRT } from "@/lib/irt";

const schema = z.object({
  module: z.enum(["M1", "M2", "M3", "M4"])
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid module" }, { status: 400 });

  const latestFailure = await prisma.testSession.findFirst({
    where: {
      userId: session.user.id,
      module: parsed.data.module,
      status: "FAILED",
      completedAt: { not: null }
    },
    orderBy: { completedAt: "desc" }
  });

  if (latestFailure?.completedAt) {
    const retryAt = new Date(latestFailure.completedAt.getTime() + IRT.cooldownHours * 60 * 60 * 1000);
    if (retryAt > new Date()) {
      return NextResponse.json({ error: `Retry available after ${retryAt.toLocaleString("en-IN")}` }, { status: 429 });
    }
  }

  const questionCount = await prisma.questionItem.count({ where: { module: parsed.data.module, isActive: true } });
  if (questionCount < IRT.minQuestions) {
    return NextResponse.json({ error: "Insufficient active question bank" }, { status: 422 });
  }

  const previousAttempts = await prisma.testSession.count({
    where: { userId: session.user.id, module: parsed.data.module }
  });

  const testSession = await prisma.testSession.create({
    data: {
      userId: session.user.id,
      module: parsed.data.module,
      attemptNumber: previousAttempts + 1
    }
  });

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: "START",
      entity: "TestSession",
      entityId: testSession.id,
      summary: `Started ${parsed.data.module} certification attempt`
    }
  });

  return NextResponse.json({ sessionId: testSession.id });
}
