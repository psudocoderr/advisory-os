import { describe, expect, it } from "vitest";
import {
  IRT,
  deadlineFor,
  isExpired,
  certificationLevel,
  estimateEap,
  information,
  probability,
  selectNextQuestion,
  shouldStop
} from "./irt";

/**
 * The adaptive certification engine decides whether a staff member is
 * certified. It is the only non-trivial mathematics in the codebase and had no
 * tests, so these pin the properties that actually matter: that ability
 * estimates move in the right direction, that confidence tightens with
 * evidence, that the stopping rule respects its bounds, and that question
 * selection never repeats an item or runs off the end of the bank.
 */

const question = (id: string, difficulty: number, discrimination = 1.0, guessing = 0.25) => ({
  id,
  difficulty,
  discrimination,
  guessing
});

/** A spread of difficulties, which is what a healthy item bank looks like. */
const bank = [
  question("q-hard-2", 2.0),
  question("q-hard-1", 1.0),
  question("q-mid", 0.0),
  question("q-easy-1", -1.0),
  question("q-easy-2", -2.0)
];

const answerAll = (correct: boolean) => bank.map((q) => ({ questionId: q.id, isCorrect: correct }));

describe("probability", () => {
  it("never falls below the guessing floor", () => {
    // Someone of very low ability still gets a 3PL item right by chance.
    expect(probability(-4, question("q", 0, 1, 0.25))).toBeGreaterThanOrEqual(0.25);
  });

  it("rises with ability", () => {
    const q = question("q", 0);
    expect(probability(1, q)).toBeGreaterThan(probability(0, q));
    expect(probability(0, q)).toBeGreaterThan(probability(-1, q));
  });

  it("is harder to answer as difficulty rises", () => {
    expect(probability(0, question("easy", -1))).toBeGreaterThan(probability(0, question("hard", 1)));
  });
});

describe("information", () => {
  it("peaks near the item's difficulty", () => {
    const q = question("q", 0.0);
    const atDifficulty = information(0.0, q);
    expect(atDifficulty).toBeGreaterThan(information(2.5, q));
    expect(atDifficulty).toBeGreaterThan(information(-2.5, q));
  });

  it("returns zero rather than NaN for a degenerate item", () => {
    // guessing >= 1 makes the item unanswerable-wrong; the formula would
    // otherwise divide by zero.
    expect(information(0, question("broken", 0, 1, 1))).toBe(0);
  });
});

describe("estimateEap", () => {
  it("reports maximum uncertainty before any evidence", () => {
    const { theta, se } = estimateEap([], bank);
    expect(theta).toBe(0);
    expect(se).toBe(99);
  });

  it("places an all-correct candidate above an all-incorrect one", () => {
    expect(estimateEap(answerAll(true), bank).theta).toBeGreaterThan(estimateEap(answerAll(false), bank).theta);
  });

  it("raises the estimate monotonically as more answers are correct", () => {
    const thetas = [0, 1, 2, 3, 4, 5].map(
      (correctCount) =>
        estimateEap(
          bank.map((q, index) => ({ questionId: q.id, isCorrect: index < correctCount })),
          bank
        ).theta
    );

    for (let i = 1; i < thetas.length; i += 1) {
      expect(thetas[i]).toBeGreaterThan(thetas[i - 1]);
    }
  });

  it("tightens the standard error as evidence accumulates", () => {
    const few = estimateEap(answerAll(true).slice(0, 2), bank);
    const many = estimateEap([...answerAll(true), ...answerAll(true).map((r) => ({ ...r }))].slice(0, 5), bank);
    expect(many.se).toBeLessThan(few.se);
  });

  it("ignores responses whose question is absent from the bank", () => {
    const withGhost = [...answerAll(true), { questionId: "not-in-bank", isCorrect: false }];
    expect(estimateEap(withGhost, bank).theta).toBeCloseTo(estimateEap(answerAll(true), bank).theta, 10);
  });

  it("keeps the estimate inside the grid bounds", () => {
    const { theta } = estimateEap(answerAll(true), bank);
    expect(theta).toBeGreaterThanOrEqual(IRT.thetaMin);
    expect(theta).toBeLessThanOrEqual(IRT.thetaMax);
  });
});

describe("selectNextQuestion", () => {
  it("never returns a question already answered", () => {
    const used = bank.slice(0, 4).map((q) => q.id);
    const next = selectNextQuestion(0, bank, used);
    expect(used).not.toContain(next.id);
    expect(next.id).toBe("q-easy-2");
  });

  it("returns nothing once the bank is exhausted", () => {
    // The session loop relies on this being falsy to end the test rather than
    // looping forever.
    expect(
      selectNextQuestion(
        0,
        bank,
        bank.map((q) => q.id)
      )
    ).toBeUndefined();
  });

  it("picks the item that best discriminates at the current ability", () => {
    expect(selectNextQuestion(2.0, bank, []).id).toBe("q-hard-2");
    expect(selectNextQuestion(-2.0, bank, []).id).toBe("q-easy-2");
  });
});

describe("shouldStop", () => {
  it("keeps going below the minimum, however confident the estimate", () => {
    expect(shouldStop(IRT.minQuestions - 1, 0.01)).toBe(false);
  });

  it("stops at the minimum once the estimate is precise enough", () => {
    expect(shouldStop(IRT.minQuestions, IRT.seStop)).toBe(true);
    expect(shouldStop(IRT.minQuestions, IRT.seStop + 0.01)).toBe(false);
  });

  it("stops at the maximum however imprecise the estimate", () => {
    expect(shouldStop(IRT.maxQuestions, 99)).toBe(true);
  });
});

describe("certificationLevel", () => {
  it("places each band at its boundary", () => {
    expect(certificationLevel(1.5)).toBe("Expert");
    expect(certificationLevel(1.49)).toBe("Proficient");
    expect(certificationLevel(1.0)).toBe("Proficient");
    expect(certificationLevel(0.99)).toBe("Foundation");
    expect(certificationLevel(IRT.passTheta)).toBe("Foundation");
    expect(certificationLevel(IRT.passTheta - 0.01)).toBe("Not Certified");
  });

  it("agrees with the pass threshold", () => {
    // Anything at or above passTheta must carry a certification level, and
    // anything below must not. These two constants drift apart easily.
    expect(certificationLevel(IRT.passTheta)).not.toBe("Not Certified");
    expect(certificationLevel(IRT.passTheta - 0.0001)).toBe("Not Certified");
  });
});

describe("time limit", () => {
  const start = new Date("2026-09-21T10:00:00.000Z");

  it("puts the deadline exactly one limit after the start", () => {
    expect(deadlineFor(start).getTime() - start.getTime()).toBe(IRT.timeLimitMinutes * 60 * 1000);
  });

  it("is not expired before the deadline", () => {
    const justBefore = new Date(deadlineFor(start).getTime() - 1000);
    expect(isExpired(start, justBefore)).toBe(false);
  });

  it("is expired after the deadline plus the skew grace", () => {
    const wellAfter = new Date(deadlineFor(start).getTime() + 10_000);
    expect(isExpired(start, wellAfter)).toBe(true);
  });

  it("grants a grace window so latency alone does not reject an answer", () => {
    // Submitted on time, arrives a moment late. Must still count.
    const barelyLate = new Date(deadlineFor(start).getTime() + 1000);
    expect(isExpired(start, barelyLate, 2000)).toBe(false);
  });

  it("does not treat the exact deadline as expired", () => {
    expect(isExpired(start, deadlineFor(start))).toBe(false);
  });
});
