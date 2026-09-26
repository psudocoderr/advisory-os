import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { estimateEap, isSessionExpired, IRT } from "@/lib/irt";
import { finalizeSession, questionBank } from "@/lib/certify-session";
import { loadTrackProgress } from "@/lib/knowledge";
import { MINIMUM_BANK_SIZE } from "@/lib/question-bank";

const schema = z.object({ moduleId: z.string().min(1) });

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid module" }, { status: 400 });

  const trainingModule = await prisma.module.findUnique({ where: { id: parsed.data.moduleId } });
  if (!trainingModule) return NextResponse.json({ error: "Module not found" }, { status: 404 });
  const moduleId = trainingModule.id;

  // The lock is enforced here, not only on the page: the test opens once every
  // chapter in the module is complete and the module before it is badged.
  const standing = await loadTrackProgress({ id: trainingModule.trackId }, session.user);
  if (!standing?.progress.find((module) => module.id === moduleId)?.testUnlocked) {
    return NextResponse.json(
      { error: "Complete every chapter in this module, and the module before it, to unlock the test." },
      { status: 403 }
    );
  }

  const activeAttempt = await prisma.testSession.findFirst({
    where: {
      userId: session.user.id,
      moduleId,
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
    if (isSessionExpired(activeAttempt.timerStartedAt)) {
      const responses = await prisma.responseLog.findMany({
        where: { sessionId: activeAttempt.id },
        select: { questionId: true, isCorrect: true }
      });
      const bank = await questionBank(activeAttempt);
      const estimate = estimateEap(responses, bank);
      await finalizeSession({
        sessionId: activeAttempt.id,
        userId: session.user.id,
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

  // TERMINATED counts toward the cooldown as much as FAILED. Without it,
  // someone removed for repeated integrity violations could start again
  // immediately, which is the opposite of the intended consequence.
  // ABANDONED is excluded on purpose: walking away is not an attempt.
  const latestFailure = await prisma.testSession.findFirst({
    where: {
      userId: session.user.id,
      moduleId,
      status: { in: ["FAILED", "TERMINATED"] },
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

  const questionCount = await prisma.questionItem.count({ where: { moduleId, isActive: true } });
  if (questionCount < MINIMUM_BANK_SIZE) {
    return NextResponse.json(
      {
        error:
          `${trainingModule.title} has ${questionCount} active question${questionCount === 1 ? "" : "s"}; ` +
          `at least ${MINIMUM_BANK_SIZE} are needed to certify. Import more with 'npm run questions:import'.`
      },
      { status: 422 }
    );
  }

  const previousAttempts = await prisma.testSession.count({
    where: { userId: session.user.id, moduleId }
  });

  const testSession = await prisma.testSession.create({
    data: {
      userId: session.user.id,
      trackId: trainingModule.trackId,
      moduleId,
      attemptNumber: previousAttempts + 1
    }
  });

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: "START",
      entity: "TestSession",
      entityId: testSession.id,
      summary: `Started ${trainingModule.title} certification attempt`
    }
  });

  return NextResponse.json({ sessionId: testSession.id });
}
