import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { candidateOnExamSurface, finalizeSession } from "@/lib/certify-session";
import { deadlineFor, estimateEap, isSessionExpired, selectNextQuestion } from "@/lib/irt";
import { prisma } from "@/lib/prisma";

type Option = { key: string; text: string };

/**
 * Hands the candidate their current question -- only while they are in
 * fullscreen.
 *
 * The session page does not contain the question. It arrives from here, after
 * the server has recorded the candidate entering fullscreen, and the browser
 * drops it again when they leave. The first successful call starts the clock.
 *
 * The question is whatever the session's state selects, so leaving and
 * returning hands back the same one: stepping out of fullscreen cannot be used
 * to skip a question.
 */
const schema = z.object({ sessionId: z.string() });

export async function POST(request: Request) {
  const auth = await getServerSession(authOptions);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const testSession = await prisma.testSession.findUnique({
    where: { id: parsed.data.sessionId },
    include: { responses: true }
  });
  if (!testSession || testSession.userId !== auth.user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (testSession.status !== "IN_PROGRESS") {
    return NextResponse.json({ error: "Session is already complete" }, { status: 400 });
  }

  const bank = await prisma.questionItem.findMany({ where: { module: testSession.module, isActive: true } });

  if (isSessionExpired(testSession.timerStartedAt)) {
    const estimate = estimateEap(testSession.responses, bank);
    const result = await finalizeSession({
      sessionId: testSession.id,
      userId: auth.user.id,
      module: testSession.module,
      theta: estimate.theta,
      se: estimate.se,
      answered: testSession.responses.length,
      reason: "TIMED_OUT"
    });
    return NextResponse.json({ complete: true, result });
  }

  if (!(await candidateOnExamSurface(testSession.id))) {
    return NextResponse.json(
      { error: "Enter fullscreen to see the question.", needsFullscreen: true },
      { status: 409 }
    );
  }

  const next = selectNextQuestion(
    testSession.abilityEstimate,
    bank,
    testSession.responses.map((response) => response.questionId)
  );
  if (!next) {
    const estimate = estimateEap(testSession.responses, bank);
    const result = await finalizeSession({
      sessionId: testSession.id,
      userId: auth.user.id,
      module: testSession.module,
      theta: estimate.theta,
      se: estimate.se,
      answered: testSession.responses.length,
      reason: "BANK_EXHAUSTED"
    });
    return NextResponse.json({ complete: true, result });
  }

  // Start the clock on the first release. Conditional, so two requests racing
  // here cannot restart it; whichever lands first sets it.
  let timerStartedAt = testSession.timerStartedAt;
  if (!timerStartedAt) {
    await prisma.testSession.updateMany({
      where: { id: testSession.id, timerStartedAt: null },
      data: { timerStartedAt: new Date() }
    });
    const started = await prisma.testSession.findUniqueOrThrow({
      where: { id: testSession.id },
      select: { timerStartedAt: true }
    });
    timerStartedAt = started.timerStartedAt!;
  }

  return NextResponse.json({
    complete: false,
    question: {
      id: next.id,
      content: next.content,
      options: (next.options as Option[]).map(({ key, text }) => ({ key, text }))
    },
    progress: {
      answered: testSession.responses.length,
      theta: testSession.abilityEstimate,
      se: testSession.standardError
    },
    deadlineMs: deadlineFor(timerStartedAt).getTime()
  });
}
