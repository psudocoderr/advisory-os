import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { estimateEap } from "@/lib/irt";
import { finalizeSession, latestFullscreenKind, questionBank } from "@/lib/certify-session";
import { prisma } from "@/lib/prisma";
import { INTEGRITY_KINDS, STRIKE_KINDS, STRIKE_LIMIT, isRedundantEvent, shouldTerminate } from "@/lib/integrity";

/**
 * Records that the candidate left the exam surface, and ends the attempt once
 * that happens too often.
 *
 * Recording is the honest part. No browser API prevents a screenshot, a phone
 * camera, a second device or a screen recorder, and fullscreen can always be
 * exited because browsers guarantee it. So this does not claim to stop
 * anything; it makes what happened visible, and acts on a pattern.
 *
 * The decision to terminate is made HERE, on the server. The browser reports
 * events and is told what happened; it never decides its own fate.
 */
const schema = z.object({
  sessionId: z.string(),
  kind: z.enum(INTEGRITY_KINDS)
});

/** Client-driven volume needs a ceiling; a held key could write unbounded rows. */
const MAX_EVENTS_PER_SESSION = 200;

export async function POST(request: Request) {
  const auth = await getServerSession(authOptions);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  const { sessionId, kind } = parsed.data;

  const testSession = await prisma.testSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true, status: true, trackId: true, moduleId: true, timerStartedAt: true }
  });
  if (!testSession || testSession.userId !== auth.user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (testSession.status !== "IN_PROGRESS") {
    // A blur can land just after the test closes. Accept it quietly.
    return NextResponse.json({ recorded: false, strikes: 0, terminated: false });
  }

  const total = await prisma.integrityEvent.count({ where: { sessionId } });
  if (total >= MAX_EVENTS_PER_SESSION) {
    return NextResponse.json({ recorded: false, strikes: total, capped: true, terminated: false });
  }

  const [fullscreenKind, sameKind] = await Promise.all([
    latestFullscreenKind(sessionId),
    prisma.integrityEvent.findFirst({
      where: { sessionId, kind },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true }
    })
  ]);
  const duplicate = isRedundantEvent(kind, {
    latestFullscreenKind: fullscreenKind,
    latestSameKindAt: sameKind?.occurredAt
  });

  if (!duplicate) {
    await prisma.integrityEvent.create({ data: { sessionId, kind } });
  }

  // Only what happens once the clock is running counts. Before the first
  // question the candidate is still getting into fullscreen, and an alt-tab
  // then has nothing to gain from.
  const strikes = testSession.timerStartedAt
    ? await prisma.integrityEvent.count({
        where: { sessionId, kind: { in: [...STRIKE_KINDS] }, occurredAt: { gte: testSession.timerStartedAt } }
      })
    : 0;

  if (!shouldTerminate(strikes)) {
    return NextResponse.json({
      recorded: !duplicate,
      strikes,
      limit: STRIKE_LIMIT,
      terminated: false
    });
  }

  // Over the limit. End the attempt on the estimate reached so far; it does
  // not certify regardless of what that estimate is.
  const responses = await prisma.responseLog.findMany({
    where: { sessionId },
    select: { questionId: true, isCorrect: true }
  });
  const bank = await questionBank(testSession);
  const estimate = estimateEap(responses, bank);

  const result = await finalizeSession({
    sessionId,
    userId: auth.user.id,
    theta: estimate.theta,
    se: estimate.se,
    answered: responses.length,
    reason: "INTEGRITY_TERMINATED"
  });

  return NextResponse.json({ recorded: true, strikes, limit: STRIKE_LIMIT, terminated: true, result });
}
