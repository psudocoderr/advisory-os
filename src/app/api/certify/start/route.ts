import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { estimateEap, isSessionExpired, IRT, rulesFor } from "@/lib/irt";
import { finalizeSession, questionBank } from "@/lib/certify-session";
import { loadTrackProgress } from "@/lib/knowledge";

/** A topic test. There is no final exam (decisions.md 2026-10-17). */
const schema = z.object({ topicId: z.string().min(1) });

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid test" }, { status: 400 });

  const topic = await prisma.topic.findUnique({
    where: { id: parsed.data.topicId },
    include: { module: { select: { trackId: true } } }
  });
  if (!topic) return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  const [trackId, topicId, title] = [topic.module.trackId, topic.id, topic.title];
  // Every query below is scoped to this one test. Never { topicId: undefined },
  // which Prisma reads as "any topic".
  const scope = { trackId, topicId };
  const rules = rulesFor(scope);

  // The lock is enforced here, not only on the page: the topic must be open
  // (its module open, the topic before it passed, not unpublished or coming
  // soon) and every chapter in it complete.
  const standing = await loadTrackProgress({ id: trackId }, session.user);
  const unlocked = standing?.progress.find((row) => row.id === topicId)?.testUnlocked;
  if (!unlocked) {
    return NextResponse.json(
      { error: "Complete every chapter in this topic, and the topic before it, to unlock the test." },
      { status: 403 }
    );
  }

  const activeAttempt = await prisma.testSession.findFirst({
    where: { userId: session.user.id, ...scope, status: "IN_PROGRESS" },
    orderBy: { startedAt: "desc" }
  });
  if (activeAttempt) {
    // Do not resume a session whose time is already gone. Resuming one meant
    // clicking Start handed back a session that had expired days earlier: the
    // countdown showed 0:00 on arrival, the test closed itself before the
    // first question, and integrity events were rejected because the session
    // was no longer active. Close it out and start fresh instead.
    if (isSessionExpired(activeAttempt.timerStartedAt, new Date(), rules)) {
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

  // Every finished attempt starts the cooldown. TERMINATED counts as much as
  // FAILED: someone removed for repeated integrity violations must not start
  // again immediately. PASSED counts too, since a retake can raise a badge:
  // without it, a trainee could resit back to back on a small bank until the
  // questions were memorised. ABANDONED is excluded: walking away is not an
  // attempt.
  const latestAttempt = await prisma.testSession.findFirst({
    where: {
      userId: session.user.id,
      ...scope,
      status: { in: ["FAILED", "TERMINATED", "PASSED"] },
      completedAt: { not: null }
    },
    orderBy: { completedAt: "desc" }
  });

  if (latestAttempt?.completedAt) {
    const retryAt = new Date(latestAttempt.completedAt.getTime() + IRT.cooldownHours * 60 * 60 * 1000);
    if (retryAt > new Date()) {
      return NextResponse.json({ error: `Retry available after ${retryAt.toLocaleString("en-IN")}` }, { status: 429 });
    }
  }

  // A test needs at least its minimum length in questions to be answerable.
  const questionCount = await prisma.questionItem.count({
    where: { isActive: true, topicId }
  });
  if (questionCount < rules.minQuestions) {
    return NextResponse.json(
      {
        error:
          `${title} has ${questionCount} active question${questionCount === 1 ? "" : "s"}; ` +
          `at least ${rules.minQuestions} are needed to certify. Import more with 'npm run questions:import'.`
      },
      { status: 422 }
    );
  }

  const previousAttempts = await prisma.testSession.count({ where: { userId: session.user.id, ...scope } });

  // Two Starts can race past the open-attempt check above. The partial unique
  // indexes from migration 20261017120000 let only one insert through; the
  // other hands back the attempt that won, as if it had been resumed.
  let testSession;
  try {
    testSession = await prisma.testSession.create({
      data: { userId: session.user.id, ...scope, attemptNumber: previousAttempts + 1 }
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const winner = await prisma.testSession.findFirstOrThrow({
      where: { userId: session.user.id, ...scope, status: "IN_PROGRESS" }
    });
    return NextResponse.json({ sessionId: winner.id, resumed: true });
  }

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: "START",
      entity: "TestSession",
      entityId: testSession.id,
      summary: `Started ${title} certification attempt`
    }
  });

  return NextResponse.json({ sessionId: testSession.id });
}
