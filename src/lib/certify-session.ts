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
export type FinishReason = "STOP_RULE" | "BANK_EXHAUSTED" | "TIMED_OUT" | "INTEGRITY_TERMINATED";

export type SessionResult = {
  passed: boolean;
  /** Ended by the system for integrity violations. Never certifies. */
  terminated: boolean;
  /**
   * True when the session ended without enough questions to count as an
   * attempt. No certification, no failure on record, and no retry cooldown.
   */
  abandoned: boolean;
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
  TIMED_OUT: "the time limit was reached",
  INTEGRITY_TERMINATED: "the attempt was ended for repeated integrity violations"
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

  /**
   * Running out of time after one question is abandonment, not failure.
   *
   * Treating it as FAILED trips the 24-hour retry cooldown in the start
   * route, which meant walking away from a test locked you out of the module
   * for a day. ABANDONED already existed in TestSessionStatus and was unused;
   * the cooldown query only matches FAILED, so this is excluded from it
   * automatically.
   */
  const abandoned = reason === "TIMED_OUT" && answered < IRT.minQuestions;

  /**
   * A terminated attempt never certifies, whatever the estimate says. Someone
   * removed for repeated violations has not demonstrated anything, and the
   * ability estimate at that point is not evidence of competence.
   */
  const terminated = reason === "INTEGRITY_TERMINATED";

  const current = await prisma.testSession.findUnique({ where: { id: sessionId } });
  if (!current) throw new Error("Session not found");

  // Idempotent. A timeout racing a final answer must not certify twice.
  if (current.status !== "IN_PROGRESS") {
    return {
      passed: current.certified,
      abandoned: current.status === "ABANDONED",
      terminated: current.status === "TERMINATED",
      theta: current.abilityEstimate,
      se: current.standardError,
      level: certificationLevel(current.abilityEstimate),
      reason,
      answered,
      remediation: current.certified ? [] : await weakestSops(sessionId)
    };
  }

  const passed = !abandoned && !terminated && theta >= IRT.passTheta;
  const level = terminated ? "Terminated" : abandoned ? "Not attempted" : certificationLevel(theta);

  await prisma.testSession.update({
    where: { id: sessionId },
    data: {
      abilityEstimate: theta,
      standardError: se,
      certified: passed,
      status: terminated ? "TERMINATED" : abandoned ? "ABANDONED" : passed ? "PASSED" : "FAILED",
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
      action: terminated ? "TERMINATE" : abandoned ? "ABANDON" : passed ? "PASS" : "FAIL",
      entity: "TestSession",
      entityId: sessionId,
      summary: terminated
        ? `TERMINATED ${module} certification after ${answered} question${answered === 1 ? "" : "s"}: repeated integrity violations. Flagged for review.`
        : abandoned
          ? `Abandoned ${module} certification after ${answered} question${answered === 1 ? "" : "s"} (${REASON_NOTE[reason]}); not counted as an attempt`
          : `${passed ? "Passed" : "Failed"} ${module} certification at theta ${theta.toFixed(2)} ` +
            `after ${answered} questions (${REASON_NOTE[reason]})`
    }
  });

  return {
    passed,
    abandoned,
    terminated,
    theta,
    se,
    level,
    reason,
    answered,
    remediation: passed || abandoned || terminated ? [] : await weakestSops(sessionId)
  };
}
