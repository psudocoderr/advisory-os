import { describe, expect, it } from "vitest";
import {
  IRT,
  deadlineFor,
  isExpired,
  isSessionExpired,
  badgeLevel,
  certificationLevel,
  CONFIDENCE_Z,
  decide,
  estimateEap,
  LEVEL_FLOOR,
  outranks,
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

  it("breaks ties the same way whatever order the bank arrives in", () => {
    // A candidate who leaves fullscreen and returns must get the same question
    // back, and the database returns rows in no guaranteed order.
    const twins = [
      { id: "q-b", difficulty: 0, discrimination: 1, guessing: 0.2 },
      { id: "q-a", difficulty: 0, discrimination: 1, guessing: 0.2 }
    ];
    expect(selectNextQuestion(0, twins, []).id).toBe("q-a");
    expect(selectNextQuestion(0, [...twins].reverse(), []).id).toBe("q-a");
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
    expect(certificationLevel(1.5)).toBe("EXPERT");
    expect(certificationLevel(1.49)).toBe("PROFICIENT");
    expect(certificationLevel(1.0)).toBe("PROFICIENT");
    expect(certificationLevel(0.99)).toBe("SATISFACTORY");
    expect(certificationLevel(IRT.passTheta)).toBe("SATISFACTORY");
    expect(certificationLevel(IRT.passTheta - 0.01)).toBeNull();
  });

  it("agrees with the pass threshold", () => {
    // Anything at or above passTheta must carry a level, and anything below
    // must not. These two constants drift apart easily.
    expect(certificationLevel(IRT.passTheta)).not.toBeNull();
    expect(certificationLevel(IRT.passTheta - 0.0001)).toBeNull();
  });
});

describe("badgeLevel", () => {
  it("awards the theta band when its percent floor is met", () => {
    expect(badgeLevel(1.6, LEVEL_FLOOR.EXPERT)).toBe("EXPERT");
    expect(badgeLevel(1.2, LEVEL_FLOOR.PROFICIENT)).toBe("PROFICIENT");
    expect(badgeLevel(IRT.passTheta, LEVEL_FLOOR.SATISFACTORY)).toBe("SATISFACTORY");
  });

  it("drops a band when the percent floor is missed", () => {
    expect(badgeLevel(1.6, LEVEL_FLOOR.EXPERT - 1)).toBe("PROFICIENT");
    expect(badgeLevel(1.2, LEVEL_FLOOR.PROFICIENT - 1)).toBe("SATISFACTORY");
  });

  it("keeps dropping until a floor is met, rather than stopping one band down", () => {
    // Expert theta at 55%: Proficient needs 60 too, so the badge is Satisfactory.
    expect(badgeLevel(1.6, 55)).toBe("SATISFACTORY");
  });

  it("awards nothing when even the lowest floor is missed", () => {
    expect(badgeLevel(1.6, LEVEL_FLOOR.SATISFACTORY - 1)).toBeNull();
  });

  it("awards nothing below the pass theta, whatever the percent", () => {
    expect(badgeLevel(IRT.passTheta - 0.01, 100)).toBeNull();
  });

  it("never awards more than the theta band", () => {
    expect(badgeLevel(IRT.passTheta, 100)).toBe("SATISFACTORY");
  });
});

describe("decide", () => {
  const pass = IRT.passTheta;

  it("passes when even the pessimistic estimate clears the mark", () => {
    expect(decide(pass + CONFIDENCE_Z * 0.3 + 0.01, 0.3, 100).outcome).toBe("PASS");
  });

  it("fails when even the optimistic estimate falls short", () => {
    expect(decide(pass - CONFIDENCE_Z * 0.3 - 0.01, 0.3, 100).outcome).toBe("FAIL");
  });

  it("calls it inconclusive when the interval straddles the mark", () => {
    expect(decide(pass, 0.3, 100).outcome).toBe("INCONCLUSIVE");
    expect(decide(pass + 0.2, 0.3, 100).outcome).toBe("INCONCLUSIVE");
    expect(decide(pass - 0.2, 0.3, 100).outcome).toBe("INCONCLUSIVE");
  });

  it("awards the level the pessimistic estimate reaches, not the point estimate", () => {
    // theta 1.65 alone is Expert; with SE 0.6 the pessimistic end is 1.05.
    expect(decide(1.65, 0.6, 100)).toEqual({ outcome: "PASS", level: "PROFICIENT" });
  });

  it("still applies the percent floors", () => {
    expect(decide(2.5, 0.2, 65)).toEqual({ outcome: "PASS", level: "PROFICIENT" });
    expect(decide(2.5, 0.2, 40)).toEqual({ outcome: "FAIL" });
  });

  it("reproduces flags.md D2: the shaky Expert is no longer certified as Expert", () => {
    // M1 PASSED  12 answers  theta 1.65  SE 0.58  ->  was certified "Expert"
    expect(decide(1.65, 0.58, 100)).toEqual({ outcome: "PASS", level: "PROFICIENT" });
  });

  it("is inconclusive with no evidence at all", () => {
    expect(decide(0, 99, 0).outcome).toBe("INCONCLUSIVE");
  });
});

describe("outranks", () => {
  it("lets a higher level replace the one held", () => {
    expect(outranks("EXPERT", "PROFICIENT")).toBe(true);
    expect(outranks("PROFICIENT", null)).toBe(true);
  });

  it("keeps the level held against an equal or lower one", () => {
    expect(outranks("PROFICIENT", "PROFICIENT")).toBe(false);
    expect(outranks("SATISFACTORY", "EXPERT")).toBe(false);
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

describe("isSessionExpired", () => {
  const start = new Date("2026-09-21T10:00:00.000Z");

  it("never expires a session whose clock has not started", () => {
    // The clock starts with the first question. Time spent getting into
    // fullscreen, or away from the page before that, is not counted.
    expect(isSessionExpired(null, new Date("2030-01-01T00:00:00.000Z"))).toBe(false);
  });

  it("expires on the clock's start, not the session's creation", () => {
    expect(isSessionExpired(start, new Date(deadlineFor(start).getTime() - 1000))).toBe(false);
    expect(isSessionExpired(start, new Date(deadlineFor(start).getTime() + 10_000))).toBe(true);
  });
});
