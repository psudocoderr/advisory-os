import type { TestSessionStatus } from "@prisma/client";
import { LEVEL_LABEL } from "@/lib/irt";
import { prisma } from "@/lib/prisma";

export type AttemptRow = {
  id: string;
  test: string;
  attemptNumber: number;
  date: Date;
  status: TestSessionStatus;
  level: string | null;
  /** Null until the first answer: the stored values are only the prior. */
  theta: number | null;
  se: number | null;
  percentCorrect: number | null;
  answered: number;
};

/** Every test attempt by one trainee, newest first. Admin only: carries theta and SE. */
export async function loadTraineeReport(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  if (!user) return null;

  const sessions = await prisma.testSession.findMany({
    where: { userId },
    include: {
      topic: { select: { title: true } },
      track: { select: { title: true } },
      responses: { select: { isCorrect: true } }
    },
    orderBy: { startedAt: "desc" }
  });

  const attempts: AttemptRow[] = sessions.map((session) => {
    const answered = session.responses.length;
    const percentCorrect = answered
      ? (100 * session.responses.filter((response) => response.isCorrect).length) / answered
      : null;
    // The attempt's own level, not the badge row's: a retake can pass below
    // the badge already held.
    return {
      id: session.id,
      test: session.topic?.title ?? `${session.track.title} final exam`,
      attemptNumber: session.attemptNumber,
      date: session.completedAt ?? session.startedAt,
      status: session.status,
      level: session.badgeLevel ? LEVEL_LABEL[session.badgeLevel] : null,
      theta: answered ? session.abilityEstimate : null,
      se: answered ? session.standardError : null,
      percentCorrect,
      answered
    };
  });

  return { user, attempts };
}

/**
 * One CSV cell. Text that a spreadsheet would read as a formula (=, +, -, @,
 * tab, CR) is prefixed with a quote, since titles and names are typed by users.
 */
export function csvCell(value: string | number | null) {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
