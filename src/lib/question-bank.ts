/**
 * Validation for the certification question bank.
 *
 * Exists because the seeded bank was degenerate in a way nobody noticed: every
 * one of 60 questions had correctKey "A", and B, C and D were the same three
 * filler strings throughout. The test was passable by choosing A repeatedly,
 * which also made every IRT difficulty parameter meaningless. These checks are
 * the ones that would have caught it.
 */

export const OPTION_KEYS = ["A", "B", "C", "D"] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];

/**
 * Questions per module the bank aims for.
 *
 * At 12 the adaptive test cannot work: maxQuestions is 18, so the bank runs
 * out before the cap and the ability estimate never reaches seStop. 40 gives
 * the selection algorithm room to choose on information rather than
 * availability, and makes the retry cooldown meaningful because a second
 * attempt is a genuinely different test.
 */
export const TARGET_BANK_SIZE = 40;

/** Below this the module cannot be certified at all. */
export const MINIMUM_BANK_SIZE = 10;

export type QuestionDraft = {
  /** Module slug, e.g. "m1". Resolved against the database on import. */
  module: string;
  /** Slug of the chapter the question tests, within that module. */
  chapterSlug: string;
  content: string;
  options: { key: string; text: string }[];
  correctKey: string;
  explanation: string;
  difficulty: number;
  discrimination: number;
  guessing: number;
};

export type Issue = { severity: "error" | "warning"; where: string; message: string };

const RANGES = {
  difficulty: [-3, 3],
  discrimination: [0.3, 2.5],
  guessing: [0, 0.5]
} as const;

/** Checks one question in isolation. Errors here block the import. */
export function validateQuestion(q: QuestionDraft, where: string): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string) => issues.push({ severity: "error", where, message });

  if (!q.module.trim()) err("module is empty");
  if (!q.chapterSlug.trim()) err("chapter is empty; every question must link to the chapter it tests");
  if (q.content.trim().length < 10) err("content is missing or too short to be a question");
  if (!q.explanation.trim()) err("explanation is empty; it is shown when reviewing a wrong answer");

  const texts = q.options.map((o) => o.text.trim());
  if (q.options.length !== 4) err(`expected 4 options, found ${q.options.length}`);
  if (texts.some((t) => !t)) err("one or more options are blank");
  if (new Set(texts.map((t) => t.toLowerCase())).size !== texts.length) err("options are not all distinct");
  if (!OPTION_KEYS.includes(q.correctKey as OptionKey)) err(`correct_key "${q.correctKey}" is not A, B, C or D`);

  for (const [field, [lo, hi]] of Object.entries(RANGES) as [keyof typeof RANGES, readonly [number, number]][]) {
    const value = q[field];
    if (!Number.isFinite(value)) err(`${field} is not a number`);
    else if (value < lo || value > hi) err(`${field} ${value} is outside the usable range ${lo} to ${hi}`);
  }

  return issues;
}

/**
 * Checks the bank as a whole. These are the checks that catch a bank which is
 * individually valid and collectively useless.
 */
export function validateBank(
  questions: QuestionDraft[],
  label = "bank",
  /**
   * Whether to check how many questions each module has.
   *
   * Off when validating an import file on its own: a file is a partial
   * contribution and may legitimately carry three questions for one module.
   * Size is only meaningful against the bank the file will become part of.
   */
  options: {
    checkSize?: boolean;
    /** Every module that should have questions, to warn about empty ones. */
    modules?: string[];
  } = {}
): Issue[] {
  const { checkSize = true, modules = [] } = options;
  const issues: Issue[] = [];
  const add = (severity: Issue["severity"], message: string) => issues.push({ severity, where: label, message });

  const byModule = new Map<string, QuestionDraft[]>();
  for (const q of questions) {
    const list = byModule.get(q.module) ?? [];
    list.push(q);
    byModule.set(q.module, list);
  }

  // Duplicate stems, across the whole set.
  const seen = new Map<string, number>();
  for (const q of questions) {
    const key = q.content.trim().toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [stem, n] of seen) {
    if (n > 1) add("error", `the same question appears ${n} times: "${stem.slice(0, 60)}"`);
  }

  for (const [code, list] of byModule) {
    // Answer-key skew. The exact defect that made the seeded bank pointless:
    // if one key dominates, the test is passable without reading it.
    const keyCounts = new Map<string, number>();
    for (const q of list) keyCounts.set(q.correctKey, (keyCounts.get(q.correctKey) ?? 0) + 1);
    for (const [key, n] of keyCounts) {
      const share = n / list.length;
      if (list.length >= 8 && share > 0.4) {
        add(
          share > 0.6 ? "error" : "warning",
          `${code}: ${Math.round(share * 100)}% of correct answers are "${key}" (${n} of ${list.length}). ` +
            `A candidate can pass by always choosing ${key}. Aim for roughly 25% per key.`
        );
      }
    }

    // Distractor reuse. Repeating the same wrong answers teaches candidates to
    // recognise the filler rather than the subject.
    const distractors = new Map<string, number>();
    for (const q of list) {
      for (const o of q.options) {
        if (o.key === q.correctKey) continue;
        const t = o.text.trim().toLowerCase();
        distractors.set(t, (distractors.get(t) ?? 0) + 1);
      }
    }
    for (const [text, n] of distractors) {
      const share = n / list.length;
      if (list.length >= 8 && share > 0.25) {
        add(
          share > 0.5 ? "error" : "warning",
          `${code}: the distractor "${text.slice(0, 44)}" is reused in ${n} of ${list.length} questions. ` +
            `Repeated filler is recognisable without knowing the answer.`
        );
      }
    }

    // Difficulty spread. An adaptive test needs range to select against.
    const diffs = list.map((q) => q.difficulty);
    if (list.length >= 8 && Math.max(...diffs) - Math.min(...diffs) < 1.5) {
      add(
        "warning",
        `${code}: difficulty spans only ${(Math.max(...diffs) - Math.min(...diffs)).toFixed(2)}. ` +
          `Adaptive selection has little to choose between; spread items from about -2 to +2.`
      );
    }

    if (checkSize) {
      if (list.length < MINIMUM_BANK_SIZE) {
        add("error", `${code}: ${list.length} questions is below the ${MINIMUM_BANK_SIZE} needed to certify at all.`);
      } else if (list.length < TARGET_BANK_SIZE) {
        add("warning", `${code}: ${list.length} of ${TARGET_BANK_SIZE} target questions.`);
      }
    }
  }

  if (checkSize) {
    for (const code of modules) {
      if (!byModule.has(code)) add("warning", `${code}: no questions supplied.`);
    }
  }

  return issues;
}
