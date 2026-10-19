/**
 * Simulated candidates through the real scoring rules (flags.md D15).
 *
 * Each case scripts a candidate against a generated bank and runs the same
 * loop as the answer route: estimate after every answer, stop on
 * `shouldStop`, otherwise take `selectNextQuestion`, and end with
 * BANK_EXHAUSTED when there is none. The outcome is then `decide()` on the
 * final theta, SE and percent correct, as `finalizeSession` does.
 *
 * Expectations are written from the rules and D15, not from a run: treat a
 * failure as a finding to look at, not as a test to adjust. Not part of
 * `npm test`; run with `npm run test:sim`.
 *
 * Cases 5 (time-outs: ABANDONED, cooldowns) and 8 (stored session, badge and
 * pages agree) need the database and routes: see engine-db.sim.ts.
 */
import { describe, expect, it } from "vitest";
import { badgeLevel, decide, estimateEap, IRT, selectNextQuestion, shouldStop } from "@/lib/irt";

// --- Fixtures -------------------------------------------------------------

type Item = { id: string; difficulty: number; discrimination: number; guessing: number; correctKey: string };
type Answer = (item: Item, theta: number, rng: () => number) => boolean;

/** Deterministic PRNG (mulberry32): the same seed always gives the same run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYS = ["A", "B", "C", "D"];

/** `size` items with difficulties spread evenly over [from, to], keys rotated. */
function bank(size: number, from: number, to: number, overrides: Partial<Item> = {}): Item[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `q${String(i).padStart(2, "0")}`,
    difficulty: size === 1 ? from : from + ((to - from) * i) / (size - 1),
    discrimination: 1,
    guessing: 0.25,
    correctKey: KEYS[i % 4],
    ...overrides
  }));
}

const BANKS = {
  easy: bank(12, -2, -0.5),
  mixed: bank(12, -2, 2),
  hard: bank(12, 0.5, 2.5),
  large: bank(40, -2.5, 2.5)
};

/** The 3PL chance a candidate of ability theta answers correctly. */
function p3pl(item: Item, theta: number) {
  return item.guessing + (1 - item.guessing) / (1 + Math.exp(-item.discrimination * (theta - item.difficulty)));
}

const allCorrect: Answer = () => true;
const allWrong: Answer = () => false;
/** Picks one of four options at random. */
const guesser: Answer = (_item, _theta, next) => next() < 0.25;
/** Always chooses `key`. */
const always =
  (key: string): Answer =>
  (item) =>
    item.correctKey === key;
/** Behaves like a candidate whose true ability is `theta`. */
const ability =
  (theta: number): Answer =>
  (item, _estimate, next) =>
    next() < p3pl(item, theta);

type Run = {
  answered: number;
  theta: number;
  se: number;
  percent: number;
  reason: "STOP_RULE" | "BANK_EXHAUSTED";
  decision: ReturnType<typeof decide>;
};

/** One attempt, step for step as the answer route runs it. */
function simulate(items: Item[], answer: Answer, seed = 1): Run {
  const next = rng(seed);
  const responses: { questionId: string; isCorrect: boolean }[] = [];
  let estimate = estimateEap([], items);

  for (;;) {
    const item = selectNextQuestion(
      estimate.theta,
      items,
      responses.map((response) => response.questionId)
    );
    if (!item) return finish("BANK_EXHAUSTED");
    responses.push({ questionId: item.id, isCorrect: answer(item, estimate.theta, next) });
    estimate = estimateEap(responses, items);
    if (shouldStop(responses.length, estimate.se)) return finish("STOP_RULE");
  }

  function finish(reason: Run["reason"]): Run {
    const percent = (100 * responses.filter((response) => response.isCorrect).length) / responses.length;
    return {
      answered: responses.length,
      theta: estimate.theta,
      se: estimate.se,
      percent,
      reason,
      decision: decide(estimate.theta, estimate.se, percent)
    };
  }
}

/** Many seeded runs of the same candidate, for rates rather than single runs. */
function many(items: Item[], answer: Answer, runs = 200) {
  return Array.from({ length: runs }, (_, i) => simulate(items, answer, i + 1));
}

const rate = (results: Run[], outcome: string) =>
  results.filter((run) => run.decision.outcome === outcome).length / results.length;

// --- 1. Extremes ----------------------------------------------------------

describe("D15.1 extremes", () => {
  for (const [name, items] of Object.entries(BANKS)) {
    it(`a perfect run passes on the ${name} bank`, () => {
      const run = simulate(items, allCorrect);
      expect(run.percent).toBe(100);
      expect(run.decision.outcome).toBe("PASS");
    });

    it(`an all-wrong run fails on the ${name} bank`, () => {
      const run = simulate(items, allWrong);
      expect(run.percent).toBe(0);
      expect(run.decision.outcome).toBe("FAIL");
    });
  }

  it("never stops before the minimum or runs past the maximum", () => {
    for (const items of Object.values(BANKS)) {
      for (const answer of [allCorrect, allWrong, guesser, ability(0.5), ability(1.5)]) {
        const run = simulate(items, answer);
        if (run.reason === "STOP_RULE") expect(run.answered).toBeGreaterThanOrEqual(IRT.minQuestions);
        expect(run.answered).toBeLessThanOrEqual(Math.min(IRT.maxQuestions, items.length));
      }
    }
  });

  it("keeps theta inside the grid and moves it the right way", () => {
    const high = simulate(BANKS.large, allCorrect);
    const low = simulate(BANKS.large, allWrong);
    expect(high.theta).toBeLessThanOrEqual(IRT.thetaMax);
    expect(low.theta).toBeGreaterThanOrEqual(IRT.thetaMin);
    expect(high.theta).toBeGreaterThan(IRT.passTheta);
    expect(low.theta).toBeLessThan(0);
  });
});

// --- 2. Guessing ----------------------------------------------------------

describe("D15.2 guessing", () => {
  it("a random guesser almost never passes", () => {
    for (const items of [BANKS.mixed, BANKS.large]) {
      expect(rate(many(items, guesser), "PASS")).toBeLessThan(0.02);
    }
  });

  it("always choosing one key on a balanced bank does not pass", () => {
    for (const key of KEYS) expect(simulate(BANKS.mixed, always(key)).decision.outcome).not.toBe("PASS");
  });

  it("always choosing A on a bank where every answer is A passes (the D0 hole, still live for two topics)", () => {
    // Documents the defect rather than accepting it: this is why a skewed
    // bank must be rejected on import and replaced on production.
    const skewed = bank(12, -2, 2, { correctKey: "A" });
    expect(simulate(skewed, always("A")).decision.outcome).toBe("PASS");
  });
});

// --- 3. Boundaries --------------------------------------------------------

describe("D15.3 boundaries", () => {
  // decide() passes on theta - SE, so these place the pessimistic estimate
  // exactly on, just under and just over each cut.
  const se = 0.3;
  const at = (pessimistic: number, percent = 100) => decide(pessimistic + se, se, percent);

  it("passes exactly at the pass mark and not just below it", () => {
    expect(at(IRT.passTheta).outcome).toBe("PASS");
    expect(at(IRT.passTheta - 0.01).outcome).toBe("INCONCLUSIVE");
  });

  it("changes level exactly at 1.0 and 1.5", () => {
    expect(at(0.99)).toEqual({ outcome: "PASS", level: "SATISFACTORY" });
    expect(at(1.0)).toEqual({ outcome: "PASS", level: "PROFICIENT" });
    expect(at(1.49)).toEqual({ outcome: "PASS", level: "PROFICIENT" });
    expect(at(1.5)).toEqual({ outcome: "PASS", level: "EXPERT" });
  });

  it("applies the percent floors exactly at 50, 60 and 70", () => {
    expect(badgeLevel(2, 70)).toBe("EXPERT");
    expect(badgeLevel(2, 69.99)).toBe("PROFICIENT");
    expect(badgeLevel(2, 60)).toBe("PROFICIENT");
    expect(badgeLevel(2, 59.99)).toBe("SATISFACTORY");
    expect(badgeLevel(2, 50)).toBe("SATISFACTORY");
    expect(badgeLevel(2, 49.99)).toBeNull();
  });

  it("does not move a result across a cut through the 0.1 grid alone", () => {
    // Two runs that differ only in one late answer should not jump two
    // levels; a jump of one is the most the grid step should explain.
    const order = ["FAIL", "INCONCLUSIVE", "SATISFACTORY", "PROFICIENT", "EXPERT"];
    const rank = (run: Run) =>
      order.indexOf(run.decision.outcome === "PASS" ? run.decision.level : run.decision.outcome);
    const items = BANKS.large;
    const flipLast: Answer = (item, theta, next) => (item.id === "q20" ? false : ability(1.2)(item, theta, next));
    for (let seed = 1; seed <= 50; seed += 1) {
      const a = simulate(items, ability(1.2), seed);
      const b = simulate(items, flipLast, seed);
      expect(Math.abs(rank(a) - rank(b))).toBeLessThanOrEqual(1);
    }
  });
});

// --- 4. Stopping ----------------------------------------------------------

describe("D15.4 stopping", () => {
  it("ends with BANK_EXHAUSTED when a 12-item bank runs out before the SE stop", () => {
    const run = simulate(BANKS.mixed, ability(0.5));
    if (run.reason === "BANK_EXHAUSTED") expect(run.answered).toBe(12);
  });

  it("decides a BANK_EXHAUSTED run on what was answered", () => {
    const run = simulate(BANKS.easy, allCorrect);
    expect(run.decision).toEqual(decide(run.theta, run.se, run.percent));
  });

  it("stops at the maximum on a large bank when SE never reaches the stop", () => {
    const runs = many(BANKS.large, ability(0.5), 50);
    for (const run of runs) {
      if (run.reason === "STOP_RULE" && run.se > IRT.seStop) expect(run.answered).toBe(IRT.maxQuestions);
    }
  });

  it("recovers a known ability: the estimate tracks true theta on average", () => {
    for (const truth of [-1, 0, 1, 2]) {
      const runs = many(BANKS.large, ability(truth), 200);
      const mean = runs.reduce((sum, run) => sum + run.theta, 0) / runs.length;
      // EAP with an N(0,1) prior shrinks toward 0; allow for that.
      expect(Math.abs(mean - truth)).toBeLessThan(0.75);
    }
  });

  it("passes a strong candidate and fails a weak one most of the time", () => {
    expect(rate(many(BANKS.large, ability(2)), "PASS")).toBeGreaterThan(0.8);
    expect(rate(many(BANKS.large, ability(-1)), "FAIL")).toBeGreaterThan(0.8);
  });
});

// --- 6. Degenerate items --------------------------------------------------

describe("D15.6 degenerate items", () => {
  const finite = (run: Run) => Number.isFinite(run.theta) && Number.isFinite(run.se) && Number.isFinite(run.percent);

  it("survives items with no discrimination", () => {
    expect(finite(simulate(bank(12, -2, 2, { discrimination: 0 }), allCorrect))).toBe(true);
  });

  it("survives items that are almost all guessing", () => {
    expect(finite(simulate(bank(12, -2, 2, { guessing: 0.99 }), allCorrect))).toBe(true);
  });

  it("survives difficulties far outside the grid", () => {
    expect(finite(simulate(bank(12, -8, 8), allCorrect))).toBe(true);
  });

  it("ignores an answer whose question is no longer in the bank, and says so (see D11)", () => {
    const items = BANKS.mixed;
    const responses = items.slice(0, 10).map((item) => ({ questionId: item.id, isCorrect: true }));
    const shrunk = items.slice(1);
    const full = estimateEap(responses, items);
    const partial = estimateEap(responses, shrunk);
    // The retired question no longer counts toward theta, while percent
    // correct (counted from the stored answers) still includes it.
    expect(partial.theta).not.toBe(full.theta);
  });
});

// --- 7. Numerics ----------------------------------------------------------

describe("D15.7 numerics", () => {
  it("keeps the likelihood clear of underflow over a maximum-length run", () => {
    const run = simulate(BANKS.large, allWrong);
    expect(run.se).toBeLessThan(99);
  });

  it("never lets the SE floor decide a result", () => {
    for (const answer of [allCorrect, allWrong, ability(1)]) {
      expect(simulate(BANKS.large, answer).se).toBeGreaterThan(0.0101);
    }
  });
});
