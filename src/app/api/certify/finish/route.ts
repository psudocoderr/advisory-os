import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { deadlineFor, estimateEap, isExpired, selectNextQuestion } from "@/lib/irt";
import { finalizeSession, type FinishReason } from "@/lib/certify-session";
import { prisma } from "@/lib/prisma";

/**
 * Ends a session without submitting an answer.
 *
 * Needed for the two endings that are not "the candidate answered something":
 * the question bank ran out, and the clock ran out. It also recovers sessions
 * left IN_PROGRESS by the old exhaustion bug, which otherwise had no route
 * back to a finished state at all.
 *
 * The browser says why it is finishing; the server checks that it is true.
 * Taking the reason on trust let a candidate answer two easy questions, claim
 * the bank was exhausted, and be certified on that estimate.
 */
const schema = z.object({
  sessionId: z.string(),
  reason: z.enum(["BANK_EXHAUSTED", "TIMED_OUT"])
});

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

  // Recompute from the stored responses rather than trusting anything the
  // client sends. The client decides *when* to finish; it never decides the
  // score.
  const bank = await prisma.questionItem.findMany({
    where: { module: testSession.module, isActive: true }
  });

  if (testSession.status === "IN_PROGRESS") {
    if (parsed.data.reason === "BANK_EXHAUSTED") {
      const next = selectNextQuestion(
        testSession.abilityEstimate,
        bank,
        testSession.responses.map((response) => response.questionId)
      );
      if (next) return NextResponse.json({ error: "There are questions left in this test." }, { status: 409 });
    }

    if (parsed.data.reason === "TIMED_OUT") {
      // No grace here, unlike an answer: this ends the test, so it waits for
      // the deadline itself. A browser whose clock runs ahead is told how
      // long is really left and asks again then.
      const started = testSession.timerStartedAt;
      if (!started || !isExpired(started, new Date(), 0)) {
        const remainingMs = started ? Math.max(0, deadlineFor(started).getTime() - Date.now()) : null;
        return NextResponse.json({ error: "Time has not run out yet.", remainingMs }, { status: 409 });
      }
    }
  }

  const estimate = estimateEap(testSession.responses, bank);

  const result = await finalizeSession({
    sessionId: testSession.id,
    userId: auth.user.id,
    module: testSession.module!,
    theta: estimate.theta,
    se: estimate.se,
    answered: testSession.responses.length,
    reason: parsed.data.reason as FinishReason
  });

  return NextResponse.json({ complete: true, result });
}
