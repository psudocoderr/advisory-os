import { certificationLevel, IRT } from "@/lib/irt";
import { prisma } from "@/lib/prisma";

/**
 * Why a test session ended.
 *
 * Every one of these is a legitimate ending. Previously only STOP_RULE was
 * handled: running out of questions returned HTTP 500 and left the session
 * IN_PROGRESS, which bricked the module for that user because the start route
 * resumes an in-progress session and the resumed page then 404s.
 */
export type FinishReason = "STOP_RULE" | "BANK_EXHAUSTED" | "TIMED_OUT";

export type SessionResult = {
  passed: boolean;
  theta: number;
  se: number;
  level: string;
  reason: FinishReason;
  answered: number;
  remediation: { title: string; slug: string; count: number }[];
};

const REASON_NOTE: Record<FinishReason, string> = {
  STOP_RULE: "the estimate reached the required confidence",
  BANK_EXHAUSTED: "every available question was answered",
  TIMED_OUT: "the time limit was reached"
};

export function reasonNote(reason: FinishReason): string {
  return REASON_NOTE[reason];
}

/** The three SOPs behind the most wrong answers, for remediation links. */
export async function weakestSops(sessionId: string) {
  const incorrect = await prisma.responseLog.findMany({
    where: { sessionId, isCorrect: false },
    include: { question: { include: { linkedSop: true } } }
  });

  const counts = new Map<string, { title: string; slug: string; count: number }>();
  for (const row of incorrect) {
    const sop = row.question.linkedSop;
    const current = counts.get(sop.id) || { title: sop.title, slug: sop.slug, count: 0 };
    current.count += 1;
    counts.set(sop.id, current);
  }

  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 3);
}

/**
 * Closes a session and returns the result.
 *
 * Single place where a session transitions out of IN_PROGRESS, so every
 * ending issues certification, writes the audit entry and builds remediation
 * identically. Safe to call on an already-finished session: it reports the
 * stored outcome rather than issuing a second certification.
 */
export async function finalizeSession(params: {
  sessionId: string;
  userId: string;
  module: string;
  theta: number;
  se: number;
  answered: number;
  reason: FinishReason;
}): Promise<SessionResult> {
  const { sessionId, userId, module, theta, se, answered, reason } = params;

  const current = await prisma.testSession.findUnique({ where: { id: sessionId } });
  if (!current) throw new Error("Session not found");

  // Idempotent. A timeout racing a final answer must not certify twice.
  if (current.status !== "IN_PROGRESS") {
    return {
      passed: current.certified,
      theta: current.abilityEstimate,
      se: current.standardError,
      level: certificationLevel(current.abilityEstimate),
      reason,
      answered,
      remediation: current.certified ? [] : await weakestSops(sessionId)
    };
  }

  const passed = theta >= IRT.passTheta;
  const level = certificationLevel(theta);

  await prisma.testSession.update({
    where: { id: sessionId },
    data: {
      abilityEstimate: theta,
      standardError: se,
      certified: passed,
      status: passed ? "PASSED" : "FAILED",
      completedAt: new Date()
    }
  });

  if (passed) {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const existing = await prisma.certification.findFirst({
      where: { userId, module: module as never, status: "ACTIVE" }
    });

    if (existing) {
      await prisma.certification.update({
        where: { id: existing.id },
        data: { sessionId, abilityScore: theta, level, issuedAt: new Date(), expiresAt }
      });
    } else {
      await prisma.certification.create({
        data: { userId, module: module as never, sessionId, abilityScore: theta, level, expiresAt }
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: passed ? "PASS" : "FAIL",
      entity: "TestSession",
      entityId: sessionId,
      summary:
        `${passed ? "Passed" : "Failed"} ${module} certification at theta ${theta.toFixed(2)} ` +
        `after ${answered} questions (${REASON_NOTE[reason]})`
    }
  });

  return {
    passed,
    theta,
    se,
    level,
    reason,
    answered,
    remediation: passed ? [] : await weakestSops(sessionId)
  };
}
