import { decide, IRT, LEVEL_LABEL, outranks, type Decision } from "@/lib/irt";
import { chapterHref } from "@/lib/knowledge";
import { FULLSCREEN_KINDS, isOnExamSurface, type IntegrityKind } from "@/lib/integrity";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Why a test session ended.
 *
 * Every one of these is a legitimate ending. Previously only STOP_RULE was
 * handled: running out of questions returned HTTP 500 and left the session
 * IN_PROGRESS, which bricked the topic for that user because the start route
 * resumes an in-progress session and the resumed page then 404s.
 */
export type FinishReason = "STOP_RULE" | "BANK_EXHAUSTED" | "TIMED_OUT" | "INTEGRITY_TERMINATED";

export type SessionResult = {
  passed: boolean;
  /** Ended by the system for integrity violations. Never certifies. */
  terminated: boolean;
  /** Too close to call. No badge, no failure on record, no cooldown. */
  inconclusive: boolean;
  /**
   * True when the session ended without enough questions to count as an
   * attempt. No certification, no failure on record, and no retry cooldown.
   */
  abandoned: boolean;
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
 * Questions a test may ask: active, and in a chapter trainees can open (D5).
 * A draft chapter's questions wait until it is published, so no one is
 * tested on material they could not read. Used for every count of a topic's
 * questions as well as the draw.
 */
export const ASKABLE = { isActive: true, chapter: { isPublished: true } } satisfies Prisma.QuestionItemWhereInput;

/**
 * The questions a session works with: its topic's askable ones, plus any it
 * has already answered. Selection skips the answered ones, so they are never
 * asked again; keeping them means a question retired or a chapter unpublished
 * mid-attempt still counts toward the score instead of silently dropping out
 * of it (D11). A session with no topic (an old final exam; none can be
 * started since 2026-10-17) gets none, so it ends as soon as it is touched.
 */
export async function questionBank(session: { id: string; topicId: string | null }) {
  if (!session.topicId) return [];
  return prisma.questionItem.findMany({
    where: { topicId: session.topicId, OR: [ASKABLE, { responses: { some: { sessionId: session.id } } }] }
  });
}

/** The three chapters behind the most wrong answers, for remediation links. */
export async function weakestChapters(sessionId: string): Promise<Remediation[]> {
  const incorrect = await prisma.responseLog.findMany({
    where: { sessionId, isCorrect: false },
    include: {
      question: {
        include: {
          chapter: {
            include: {
              topic: {
                select: { slug: true, module: { select: { slug: true, track: { select: { slug: true } } } } }
              }
            }
          }
        }
      }
    }
  });

  const counts = new Map<string, Remediation>();
  for (const row of incorrect) {
    const chapter = row.question.chapter;
    // A chapter unpublished since would be a link to a 404.
    if (!chapter?.isPublished) continue;
    const current = counts.get(chapter.id) || {
      title: chapter.title,
      href: chapterHref(chapter.topic.module.track.slug, chapter.topic.module.slug, chapter.topic.slug, chapter.slug),
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
   * A terminated attempt never certifies, whatever the estimate says. Someone
   * removed for repeated violations has not demonstrated anything, and the
   * ability estimate at that point is not evidence of competence.
   */
  const terminated = reason === "INTEGRITY_TERMINATED";

  const current = await prisma.testSession.findUnique({
    where: { id: sessionId },
    include: { topic: { select: { title: true } }, track: { select: { title: true } } }
  });
  if (!current) throw new Error("Session not found");

  /**
   * Running out of time after one question is abandonment, not failure.
   *
   * Treating it as FAILED trips the 24-hour retry cooldown in the start
   * route, which meant walking away from a test locked you out of the topic
   * for a day. ABANDONED already existed in TestSessionStatus and was unused;
   * the cooldown query only matches FAILED, so this is excluded from it
   * automatically.
   */
  const abandoned = reason === "TIMED_OUT" && answered < IRT.minQuestions;

  const label = current.topic?.title ?? `${current.track.title} final exam`;
  const percentCorrect = await sessionPercentCorrect(sessionId);

  /**
   * What an already-finished session recorded, reported instead of finishing
   * it again (D12): the level and answer count come from the stored attempt,
   * the same way the first finish worked them out. The reason is stored only
   * through the status, so it is derived where the status decides it
   * (TERMINATED, ABANDONED) and otherwise left as the caller's.
   */
  const storedResult = async (stored: {
    status: string;
    certified: boolean;
    abilityEstimate: number;
    standardError: number;
  }): Promise<SessionResult> => {
    const wasTerminated = stored.status === "TERMINATED";
    const wasAbandoned = stored.status === "ABANDONED";
    return {
      passed: stored.certified,
      abandoned: wasAbandoned,
      terminated: wasTerminated,
      inconclusive: stored.status === "INCONCLUSIVE",
      level: wasTerminated
        ? "Terminated"
        : wasAbandoned
          ? "Not attempted"
          : levelLabel(decide(stored.abilityEstimate, stored.standardError, percentCorrect)),
      reason: wasTerminated ? "INTEGRITY_TERMINATED" : wasAbandoned ? "TIMED_OUT" : reason,
      answered: await prisma.responseLog.count({ where: { sessionId } }),
      remediation: stored.certified || wasTerminated || wasAbandoned ? [] : await weakestChapters(sessionId)
    };
  };

  // Idempotent. A timeout racing a final answer must not certify twice.
  if (current.status !== "IN_PROGRESS") return storedResult(current);

  const decision = abandoned || terminated ? null : decide(theta, se, percentCorrect);
  const badgeLevel = decision?.outcome === "PASS" ? decision.level : null;
  const passed = badgeLevel !== null;
  const inconclusive = decision?.outcome === "INCONCLUSIVE";
  const level = terminated ? "Terminated" : abandoned ? "Not attempted" : levelLabel(decision);

  // Conditional on the session still being open. Two requests can both pass
  // the check above (an answer that ends the test and a fourth integrity
  // strike, say); only one of them may close it. The other issues no badge
  // and writes no audit entry: it reports what the winner recorded.
  const { count } = await prisma.testSession.updateMany({
    where: { id: sessionId, status: "IN_PROGRESS" },
    data: {
      abilityEstimate: theta,
      standardError: se,
      certified: passed,
      status: terminated
        ? "TERMINATED"
        : abandoned
          ? "ABANDONED"
          : inconclusive
            ? "INCONCLUSIVE"
            : passed
              ? "PASSED"
              : "FAILED",
      completedAt: new Date()
    }
  });
  if (count === 0) return storedResult(await prisma.testSession.findUniqueOrThrow({ where: { id: sessionId } }));

  if (badgeLevel) {
    const data = { sessionId, abilityScore: theta, badgeLevel, percentCorrect, issuedAt: new Date() };

    const held = { userId, trackId: current.trackId, topicId: current.topicId, status: "ACTIVE" as const };

    // The best level stands: a retake that scores lower passes, but leaves
    // the badge already held untouched.
    const keepBest = async (existing: { id: string; badgeLevel: typeof badgeLevel | null }) => {
      if (outranks(badgeLevel, existing.badgeLevel)) {
        await prisma.certification.update({ where: { id: existing.id }, data });
      }
    };

    const existing = await prisma.certification.findFirst({ where: held });
    if (existing) {
      await keepBest(existing);
    } else {
      try {
        await prisma.certification.create({
          data: { ...data, userId, trackId: current.trackId, topicId: current.topicId }
        });
      } catch (error) {
        // Two attempts certified at once (e.g. a double-clicked Start left two
        // sessions): the lookup above saw nothing for either, and a unique
        // index refused the second row. Apply the best-level rule to the row
        // that won instead of failing a finished test.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
        await keepBest(await prisma.certification.findFirstOrThrow({ where: held }));
      }
    }
  }

  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: terminated
        ? "TERMINATE"
        : abandoned
          ? "ABANDON"
          : inconclusive
            ? "INCONCLUSIVE"
            : passed
              ? "PASS"
              : "FAIL",
      entity: "TestSession",
      entityId: sessionId,
      summary: terminated
        ? `TERMINATED ${label} certification after ${answered} question${answered === 1 ? "" : "s"}: repeated integrity violations. Flagged for review.`
        : abandoned
          ? `Abandoned ${label} certification after ${answered} question${answered === 1 ? "" : "s"} (${REASON_NOTE[reason]}); not counted as an attempt`
          : `${passed ? `Passed (${level})` : inconclusive ? "Inconclusive" : "Failed"} ${label} certification ` +
            `at theta ${theta.toFixed(2)} (SE ${se.toFixed(2)}), ${percentCorrect.toFixed(0)}% correct, ` +
            `after ${answered} questions (${REASON_NOTE[reason]})`
    }
  });

  return {
    passed,
    abandoned,
    terminated,
    inconclusive,
    level,
    reason,
    answered,
    remediation: passed || abandoned || terminated ? [] : await weakestChapters(sessionId)
  };
}

/** Share of a session's answers that were correct, 0-100. */
export async function sessionPercentCorrect(sessionId: string) {
  const responses = await prisma.responseLog.findMany({ where: { sessionId }, select: { isCorrect: true } });
  return responses.length ? (100 * responses.filter((response) => response.isCorrect).length) / responses.length : 0;
}

function levelLabel(decision: Decision | null) {
  if (decision?.outcome === "PASS") return LEVEL_LABEL[decision.level];
  return decision?.outcome === "INCONCLUSIVE" ? "Inconclusive" : "Not certified";
}
