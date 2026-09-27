import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { estimateEap, isSessionExpired, IRT, rulesFor } from "@/lib/irt";
import { finalizeSession, questionBank } from "@/lib/certify-session";
import { loadTrackProgress } from "@/lib/knowledge";

/** A module test, or with `trackId` the track's final exam. */
const schema = z.union([z.object({ moduleId: z.string().min(1) }), z.object({ trackId: z.string().min(1) })]);

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid test" }, { status: 400 });

  let trackId: string;
  let moduleId: string | null;
  let title: string;
  if ("moduleId" in parsed.data) {
    const trainingModule = await prisma.module.findUnique({ where: { id: parsed.data.moduleId } });
    if (!trainingModule) return NextResponse.json({ error: "Module not found" }, { status: 404 });
    [trackId, moduleId, title] = [trainingModule.trackId, trainingModule.id, trainingModule.title];
  } else {
    const track = await prisma.track.findUnique({ where: { id: parsed.data.trackId } });
    if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });
    [trackId, moduleId, title] = [track.id, null, `${track.title} final exam`];
  }
  // Every query below is scoped to this one test: a module's, or the track's
  // final exam (moduleId null). Never { moduleId: undefined }, which Prisma
  // reads as "any module".
  const scope = { trackId, moduleId };
  const rules = rulesFor(scope);

  // The lock is enforced here, not only on the page. A module test opens once
  // every chapter in the module is complete and the module before it is
  // badged; the final exam once every module is badged.
  const standing = await loadTrackProgress({ id: trackId }, session.user);
  const unlocked = moduleId
    ? standing?.progress.find((module) => module.id === moduleId)?.testUnlocked
    : standing?.finalUnlocked;
  if (!unlocked) {
    return NextResponse.json(
      {
        error: moduleId
          ? "Complete every chapter in this module, and the module before it, to unlock the test."
          : "Earn every module badge in this track to unlock the final exam."
      },
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
    where: { isActive: true, ...(moduleId ? { moduleId } : { trainingModule: { trackId } }) }
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

  const testSession = await prisma.testSession.create({
    data: { userId: session.user.id, ...scope, attemptNumber: previousAttempts + 1 }
  });

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
