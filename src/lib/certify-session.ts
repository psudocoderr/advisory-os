import { certificationLevel, IRT, LEVEL_LABEL } from "@/lib/irt";
import { chapterHref } from "@/lib/knowledge";
import { FULLSCREEN_KINDS, isOnExamSurface, type IntegrityKind } from "@/lib/integrity";
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
  remediation: Remediation[];
};

export type Remediation = { title: string; href: string; count: number };

const REASON_NOTE: Record<FinishReason, string> = {
  STOP_RULE: "the estimate reached the required confidence",
  BANK_EXHAUSTED: "every available question was answered",
  TIMED_OUT: "the time limit was reached",
  INTEGRITY_TERMINATED: "the attempt was ended for repeated integrity violations"
};

export function reasonNote(reason: FinishReason): string {
  return REASON_NOTE[reason];
}

/** The most recent fullscreen event recorded for a session, if any. */
export async function latestFullscreenKind(sessionId: string): Promise<IntegrityKind | null> {
  const latest = await prisma.integrityEvent.findFirst({
    where: { sessionId, kind: { in: [...FULLSCREEN_KINDS] } },
    orderBy: { occurredAt: "desc" },
    select: { kind: true }
  });
  return latest?.kind ?? null;
}

/**
 * Whether the server's record says the candidate is in fullscreen. Gates both
 * releasing a question and accepting an answer.
 */
export async function candidateOnExamSurface(sessionId: string): Promise<boolean> {
  return isOnExamSurface(await latestFullscreenKind(sessionId));
}

/**
 * The active questions a session draws from: its module's, or on a final
 * exam (no module) every module's in the track.
 */
export function questionBank(session: { trackId: string | null; moduleId: string | null }) {
  if (session.moduleId) return prisma.questionItem.findMany({ where: { moduleId: session.moduleId, isActive: true } });
  // Never fall through to an unfiltered query: that is every question in
  // every track.
  if (!session.trackId) throw new Error("Test session has neither a module nor a track");
  return prisma.questionItem.findMany({
    where: { trainingModule: { trackId: session.trackId }, isActive: true }
  });
}

/** The three chapters behind the most wrong answers, for remediation links. */
export async function weakestChapters(sessionId: string): Promise<Remediation[]> {
  const incorrect = await prisma.responseLog.findMany({
    where: { sessionId, isCorrect: false },
    include: {
      question: {
        include: { chapter: { include: { module: { include: { track: { select: { slug: true } } } } } } }
      }
    }
  });

  const counts = new Map<string, Remediation>();
  for (const row of incorrect) {
    const chapter = row.question.chapter;
    if (!chapter) continue;
    const current = counts.get(chapter.id) || {
      title: chapter.title,
      href: chapterHref(chapter.module.track.slug, chapter.module.slug, chapter.slug),
      count: 0
    };
    current.count += 1;
    counts.set(chapter.id, current);
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
  theta: number;
  se: number;
  answered: number;
  reason: FinishReason;
}): Promise<SessionResult> {
  const { sessionId, userId, theta, se, answered, reason } = params;

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

  const current = await prisma.testSession.findUnique({
    where: { id: sessionId },
    include: { trainingModule: { select: { title: true } }, track: { select: { title: true } } }
  });
  if (!current) throw new Error("Session not found");
  const label = current.trainingModule?.title ?? current.track?.title ?? "test";

  // Idempotent. A timeout racing a final answer must not certify twice.
  if (current.status !== "IN_PROGRESS") {
    return {
      passed: current.certified,
      abandoned: current.status === "ABANDONED",
      terminated: current.status === "TERMINATED",
      theta: current.abilityEstimate,
      se: current.standardError,
      level: levelLabel(current.certified ? certificationLevel(current.abilityEstimate) : null),
      reason,
      answered,
      remediation: current.certified ? [] : await weakestChapters(sessionId)
    };
  }

  const badgeLevel = abandoned || terminated ? null : certificationLevel(theta);
  const passed = badgeLevel !== null;
  const level = terminated ? "Terminated" : abandoned ? "Not attempted" : levelLabel(badgeLevel);

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
    const responses = await prisma.responseLog.findMany({ where: { sessionId }, select: { isCorrect: true } });
    const percentCorrect = responses.length
      ? (100 * responses.filter((response) => response.isCorrect).length) / responses.length
      : 0;
    const data = { sessionId, abilityScore: theta, badgeLevel, percentCorrect, issuedAt: new Date() };

    const existing = await prisma.certification.findFirst({
      where: { userId, trackId: current.trackId, moduleId: current.moduleId, status: "ACTIVE" }
    });

    if (existing) {
      await prisma.certification.update({ where: { id: existing.id }, data });
    } else {
      await prisma.certification.create({
        data: { ...data, userId, trackId: current.trackId, moduleId: current.moduleId }
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
        ? `TERMINATED ${label} certification after ${answered} question${answered === 1 ? "" : "s"}: repeated integrity violations. Flagged for review.`
        : abandoned
          ? `Abandoned ${label} certification after ${answered} question${answered === 1 ? "" : "s"} (${REASON_NOTE[reason]}); not counted as an attempt`
          : `${passed ? "Passed" : "Failed"} ${label} certification at theta ${theta.toFixed(2)} ` +
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
    remediation: passed || abandoned || terminated ? [] : await weakestChapters(sessionId)
  };
}

function levelLabel(level: ReturnType<typeof certificationLevel>) {
  return level ? LEVEL_LABEL[level] : "Not certified";
}
