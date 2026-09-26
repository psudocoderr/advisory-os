import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { estimateEap, isSessionExpired, selectNextQuestion, shouldStop } from "@/lib/irt";
import { candidateOnExamSurface, finalizeSession } from "@/lib/certify-session";
import { prisma } from "@/lib/prisma";

type Option = { key: string; text: string };

const schema = z.object({
  sessionId: z.string(),
  questionId: z.string(),
  selectedKey: z.enum(["A", "B", "C", "D"]),
  responseTimeMs: z
    .number()
    .int()
    .min(0)
    .max(30 * 60 * 1000)
});

export async function POST(request: Request) {
  const auth = await getServerSession(authOptions);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid answer" }, { status: 400 });
  const input = parsed.data;

  const testSession = await prisma.testSession.findUnique({
    where: { id: input.sessionId },
    include: { responses: true }
  });
  if (!testSession || testSession.userId !== auth.user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (testSession.status !== "IN_PROGRESS") {
    return NextResponse.json({ error: "Session is already complete" }, { status: 400 });
  }
  if (testSession.responses.some((response) => response.questionId === input.questionId)) {
    return NextResponse.json({ error: "Question already answered" }, { status: 409 });
  }

  // Time is enforced here, not in the browser. The countdown on screen is a
  // display; a client clock can be wrong or deliberately changed. An answer
  // arriving after the deadline does not count, and the session closes on the
  // estimate reached before time ran out.
  if (isSessionExpired(testSession.timerStartedAt)) {
    const bankForScore = await prisma.questionItem.findMany({
      where: { module: testSession.module, isActive: true }
    });
    const expiredEstimate = estimateEap(testSession.responses, bankForScore);
    const result = await finalizeSession({
      sessionId: testSession.id,
      userId: auth.user.id,
      module: testSession.module!,
      theta: expiredEstimate.theta,
      se: expiredEstimate.se,
      answered: testSession.responses.length,
      reason: "TIMED_OUT"
    });
    return NextResponse.json({ complete: true, result });
  }

  // No question has been released until the clock starts, and none is
  // answerable outside fullscreen. Both are the server's record, not the
  // browser's say-so: pressing Escape and answering anyway does not work.
  if (!testSession.timerStartedAt || !(await candidateOnExamSurface(testSession.id))) {
    return NextResponse.json({ error: "Return to fullscreen to answer.", needsFullscreen: true }, { status: 409 });
  }

  const bank = await prisma.questionItem.findMany({ where: { module: testSession.module, isActive: true } });

  // Only the question the session is on can be answered. Selection is
  // deterministic, so this is the one the question route released. Without
  // it, anyone who knew question ids could choose which ones to answer.
  const question = selectNextQuestion(
    testSession.abilityEstimate,
    bank,
    testSession.responses.map((response) => response.questionId)
  );
  if (!question || question.id !== input.questionId) {
    return NextResponse.json({ error: "That is not the current question." }, { status: 409 });
  }

  const isCorrect = question.correctKey === input.selectedKey;
  const responseHistory = [...testSession.responses, { questionId: question.id, isCorrect }];
  const estimate = estimateEap(responseHistory, bank);
  const answeredCount = responseHistory.length;

  await prisma.responseLog.create({
    data: {
      sessionId: testSession.id,
      questionId: question.id,
      selectedKey: input.selectedKey,
      isCorrect,
      responseTimeMs: input.responseTimeMs,
      abilityAfter: estimate.theta,
      seAfter: estimate.se
    }
  });

  if (shouldStop(answeredCount, estimate.se)) {
    const result = await finalizeSession({
      sessionId: testSession.id,
      userId: auth.user.id,
      module: testSession.module!,
      theta: estimate.theta,
      se: estimate.se,
      answered: answeredCount,
      reason: "STOP_RULE"
    });
    return NextResponse.json({ complete: true, result });
  }

  await prisma.testSession.update({
    where: { id: testSession.id },
    data: { abilityEstimate: estimate.theta, standardError: estimate.se }
  });

  const usedIds = responseHistory.map((response) => response.questionId);
  const next = selectNextQuestion(estimate.theta, bank, usedIds);

  // Running out of questions ends the test. It used to return HTTP 500 and
  // leave the session IN_PROGRESS, which permanently bricked the module: the
  // start route resumes an in-progress session, and the resumed page 404s
  // because it cannot find a next question either.
  if (!next) {
    const result = await finalizeSession({
      sessionId: testSession.id,
      userId: auth.user.id,
      module: testSession.module!,
      theta: estimate.theta,
      se: estimate.se,
      answered: answeredCount,
      reason: "BANK_EXHAUSTED"
    });
    return NextResponse.json({ complete: true, result });
  }

  return NextResponse.json({
    complete: false,
    question: sanitizeQuestion(next),
    progress: {
      answered: answeredCount,
      theta: estimate.theta,
      se: estimate.se
    }
  });
}

function sanitizeQuestion(question: { id: string; content: string; options: unknown }) {
  const options = question.options as Option[];
  return {
    id: question.id,
    content: question.content,
    options: options.map(({ key, text }) => ({ key, text }))
  };
}
