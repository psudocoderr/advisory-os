import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { estimateEap, isExpired, IRT } from "@/lib/irt";
import { finalizeSession } from "@/lib/certify-session";

const schema = z.object({
  module: z.enum(["M1", "M2", "M3", "M4", "M5"])
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid module" }, { status: 400 });

  const activeAttempt = await prisma.testSession.findFirst({
    where: {
      userId: session.user.id,
      module: parsed.data.module,
      status: "IN_PROGRESS"
    },
    orderBy: { startedAt: "desc" }
  });
  if (activeAttempt) {
    // Do not resume a session whose time is already gone. Resuming one meant
    // clicking Start handed back a session that had expired days earlier: the
    // countdown showed 0:00 on arrival, the test closed itself before the
    // first question, and integrity events were rejected because the session
    // was no longer active. Close it out and start fresh instead.
    if (isExpired(activeAttempt.startedAt)) {
      const responses = await prisma.responseLog.findMany({
        where: { sessionId: activeAttempt.id },
        select: { questionId: true, isCorrect: true }
      });
      const bank = await prisma.questionItem.findMany({
        where: { module: parsed.data.module, isActive: true }
      });
      const estimate = estimateEap(responses, bank);
      await finalizeSession({
        sessionId: activeAttempt.id,
        userId: session.user.id,
        module: activeAttempt.module,
        theta: estimate.theta,
        se: estimate.se,
        answered: responses.length,
        reason: "TIMED_OUT"
      });
      // Falls through to create a new attempt below.
    } else {
      return NextResponse.json({ sessionId: activeAttempt.id, resumed: true });
    }
  }

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
