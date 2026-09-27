import type { BadgeLevel, QuestionItem, ResponseLog } from "@prisma/client";

export const IRT = {
  passTheta: 0.5,
  minQuestions: 10,
  maxQuestions: 18,
  seStop: 0.3,
  timeLimitMinutes: 20,
  thetaMin: -4,
  thetaMax: 4,
  cooldownHours: 24
};

/** How long a test runs and when it stops. Module tests use IRT itself. */
export type TestRules = Pick<typeof IRT, "minQuestions" | "maxQuestions" | "seStop" | "timeLimitMinutes">;

/**
 * The final exam: the same adaptive engine over every question in the track,
 * spread evenly across its modules.
 *
 * Placeholders until the client confirms length and duration; change them
 * here. The pass rule is the modules' one (decide below).
 */
export const FINAL_EXAM: TestRules = {
  minQuestions: 20,
  maxQuestions: 40,
  seStop: 0.3,
  timeLimitMinutes: 45
};

/** A session with no module is a final exam. */
export function rulesFor(session: { moduleId: string | null }): TestRules {
  return session.moduleId ? IRT : FINAL_EXAM;
}

type ResponseLike = Pick<ResponseLog, "questionId" | "isCorrect">;
type QuestionLike = Pick<QuestionItem, "id" | "difficulty" | "discrimination" | "guessing">;

/** When a session whose clock started at `startedAt` must end. */
export function deadlineFor(startedAt: Date, rules: TestRules = IRT): Date {
  return new Date(startedAt.getTime() + rules.timeLimitMinutes * 60 * 1000);
}

/**
 * Whether a session has run out of time.
 *
 * The server calls this on every write. The countdown in the browser is a
 * display, not a control: a client clock can be wrong or deliberately changed,
 * so nothing is allowed to depend on it.
 *
 * `skewMs` grants a small grace so an answer submitted a fraction of a second
 * before the deadline is not rejected by network latency alone.
 */
export function isExpired(startedAt: Date, now: Date = new Date(), skewMs = 2000, rules: TestRules = IRT): boolean {
  return now.getTime() > deadlineFor(startedAt, rules).getTime() + skewMs;
}

/**
 * Whether a session has run out of time, given when its clock started.
 *
 * The clock starts when the first question is released, not when the session
 * is created: time spent getting into fullscreen is not time spent answering.
 * A session whose clock has not started cannot have run out.
 */
export function isSessionExpired(timerStartedAt: Date | null, now: Date = new Date(), rules: TestRules = IRT): boolean {
  return timerStartedAt !== null && isExpired(timerStartedAt, now, 2000, rules);
}

export function probability(theta: number, question: QuestionLike) {
  const a = question.discrimination;
  const b = question.difficulty;
  const c = question.guessing;
  return c + (1 - c) / (1 + Math.exp(-1.702 * a * (theta - b)));
}

export function information(theta: number, question: QuestionLike) {
  const p = probability(theta, question);
  const q = 1 - p;
  if (p <= 0 || q <= 0 || question.guessing >= 1) return 0;
  const inner = (1.702 * question.discrimination * (p - question.guessing)) / (1 - question.guessing);
  return (inner * inner * q) / p;
}

export function estimateEap(responses: ResponseLike[], questions: QuestionLike[]) {
  if (responses.length === 0) return { theta: 0, se: 99 };
  const questionMap = new Map(questions.map((q) => [q.id, q]));
  const grid: number[] = [];
  for (let theta = IRT.thetaMin; theta <= IRT.thetaMax + 0.0001; theta += 0.1) {
    grid.push(Number(theta.toFixed(1)));
  }

  const weights = grid.map((theta) => {
    const prior = Math.exp(-(theta * theta) / 2);
    const likelihood = responses.reduce((acc, response) => {
      const question = questionMap.get(response.questionId);
      if (!question) return acc;
      const p = Math.min(0.999999, Math.max(0.000001, probability(theta, question)));
      return acc * (response.isCorrect ? p : 1 - p);
    }, 1);
    return prior * likelihood;
  });

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return { theta: 0, se: 99 };

  const mean = grid.reduce((sum, theta, index) => sum + theta * weights[index], 0) / total;
  const variance = grid.reduce((sum, theta, index) => sum + (theta - mean) ** 2 * weights[index], 0) / total;

  return {
    theta: clamp(mean),
    se: Math.sqrt(Math.max(variance, 0.0001))
  };
}

/**
 * The most informative unused question.
 *
 * With `balance` (the final exam), only questions from the module with the
 * fewest answered so far are candidates, so the exam covers every module
 * evenly instead of homing in on whichever module has the most informative
 * items. Deterministic either way: the answer route recomputes this to check
 * which question is current.
 */
export function selectNextQuestion<T extends QuestionLike & { moduleId?: string | null }>(
  theta: number,
  questions: T[],
  usedQuestionIds: string[],
  balance = false
) {
  const used = new Set(usedQuestionIds);
  let candidates = questions.filter((question) => !used.has(question.id));
  if (balance && candidates.length) {
    const answered = new Map<string, number>();
    for (const question of questions) {
      const key = question.moduleId ?? "";
      answered.set(key, (answered.get(key) ?? 0) + (used.has(question.id) ? 1 : 0));
    }
    const fewest = Math.min(...candidates.map((question) => answered.get(question.moduleId ?? "")!));
    candidates = candidates.filter((question) => answered.get(question.moduleId ?? "") === fewest);
  }
  return (
    candidates
      // Ties broken by id so the same state always yields the same question.
      // The bank arrives in no guaranteed order, and a candidate who leaves and
      // re-enters fullscreen must be handed back the question they left, not a
      // different one of equal information.
      .sort((a, b) => information(theta, b) - information(theta, a) || a.id.localeCompare(b.id))[0]
  );
}

export function shouldStop(answered: number, se: number, rules: TestRules = IRT) {
  return answered >= rules.maxQuestions || (answered >= rules.minQuestions && se <= rules.seStop);
}

/** The level a theta reaches on its own, or null below the pass mark. */
export function certificationLevel(theta: number): BadgeLevel | null {
  if (theta >= 1.5) return "EXPERT";
  if (theta >= 1.0) return "PROFICIENT";
  if (theta >= IRT.passTheta) return "SATISFACTORY";
  return null;
}

const LEVELS: BadgeLevel[] = ["SATISFACTORY", "PROFICIENT", "EXPERT"];

/**
 * Share of answers each level also needs correct, 0-100. The client may tune
 * these.
 *
 * A floor, not a second score. An adaptive test gives each candidate
 * questions near their own ability, so everyone's percent correct drifts to
 * roughly the same range and cannot rank people; theta does that. The floor
 * only stops a lucky theta from carrying a badge alongside a poor hit rate.
 */
export const LEVEL_FLOOR: Record<BadgeLevel, number> = { SATISFACTORY: 50, PROFICIENT: 60, EXPERT: 70 };

/**
 * The badge an attempt earns: the highest level whose theta band and percent
 * floor are both met, or null for no badge.
 */
export function badgeLevel(theta: number, percentCorrect: number): BadgeLevel | null {
  const band = certificationLevel(theta);
  if (!band) return null;
  for (let index = LEVELS.indexOf(band); index >= 0; index -= 1) {
    if (percentCorrect >= LEVEL_FLOOR[LEVELS[index]]) return LEVELS[index];
  }
  return null;
}

/**
 * How far, in standard errors, the estimate must clear a cut-off to count.
 * 1 is about 84% one-sided confidence.
 */
export const CONFIDENCE_Z = 1;

export type Decision = { outcome: "PASS"; level: BadgeLevel } | { outcome: "FAIL" } | { outcome: "INCONCLUSIVE" };

/**
 * Pass, fail, or too close to call (flags.md D2).
 *
 * The test often ends before the estimate is tight: the bank runs out, or the
 * question cap is reached. Rather than certify on whatever the estimate was,
 * ask whether it is confidently on one side of the pass mark:
 * - pass when even the pessimistic end (theta - Z*SE) clears it, at the
 *   level that pessimistic end reaches, so a shaky result earns the lower
 *   level;
 * - fail when even the optimistic end (theta + Z*SE) does not, or when the
 *   percent-correct floors rule out every level;
 * - otherwise inconclusive: no badge and no failure on record.
 *
 * Requiring SE <= seStop instead was simulated and rejected: with typical
 * items (discrimination around 1) no candidate reaches it within
 * maxQuestions, even on a 40-item bank, so no one would ever pass.
 */
export function decide(theta: number, se: number, percentCorrect: number): Decision {
  if (theta + CONFIDENCE_Z * se < IRT.passTheta) return { outcome: "FAIL" };
  const pessimistic = theta - CONFIDENCE_Z * se;
  if (pessimistic < IRT.passTheta) return { outcome: "INCONCLUSIVE" };
  const level = badgeLevel(pessimistic, percentCorrect);
  return level ? { outcome: "PASS", level } : { outcome: "FAIL" };
}

/** Whether `candidate` is a better badge than `held`. The best level stands. */
export function outranks(candidate: BadgeLevel, held: BadgeLevel | null): boolean {
  return held === null || LEVELS.indexOf(candidate) > LEVELS.indexOf(held);
}

export const LEVEL_LABEL: Record<BadgeLevel, string> = {
  SATISFACTORY: "Satisfactory",
  PROFICIENT: "Proficient",
  EXPERT: "Expert"
};

function clamp(value: number) {
  return Math.max(IRT.thetaMin, Math.min(IRT.thetaMax, value));
}
