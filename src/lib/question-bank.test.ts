import { describe, expect, it } from "vitest";
import { MINIMUM_BANK_SIZE, validateBank, validateQuestion, type Issue, type QuestionDraft } from "./question-bank";

const q = (over: Partial<QuestionDraft> = {}, i = 0): QuestionDraft => ({
  module: "M1",
  sopSlug: "day-1-kyc",
  content: `A sufficiently long question stem number ${i}?`,
  options: [
    { key: "A", text: `alpha ${i}` },
    { key: "B", text: `bravo ${i}` },
    { key: "C", text: `charlie ${i}` },
    { key: "D", text: `delta ${i}` }
  ],
  correctKey: "ABCD"[i % 4],
  explanation: "Because it preserves a reviewable trail.",
  difficulty: -2 + (i % 9) * 0.5,
  discrimination: 1,
  guessing: 0.25,
  ...over
});

const bank = (n: number, over: (i: number) => Partial<QuestionDraft> = () => ({})) =>
  Array.from({ length: n }, (_, i) => q(over(i), i));

const errors = (issues: Issue[]) => issues.filter((x) => x.severity === "error");

describe("validateQuestion", () => {
  it("accepts a well-formed question", () => {
    expect(errors(validateQuestion(q(), "row 1"))).toHaveLength(0);
  });

  it("rejects duplicate option texts", () => {
    const bad = q({
      options: [
        { key: "A", text: "same" },
        { key: "B", text: "same" },
        { key: "C", text: "other" },
        { key: "D", text: "another" }
      ]
    });
    expect(
      errors(validateQuestion(bad, "row"))
        .map((e) => e.message)
        .join()
    ).toMatch(/distinct/);
  });

  it("rejects a correct_key outside A-D", () => {
    expect(
      errors(validateQuestion(q({ correctKey: "E" }), "row"))
        .map((e) => e.message)
        .join()
    ).toMatch(/not A, B, C or D/);
  });

  it("rejects IRT parameters outside their usable range", () => {
    expect(errors(validateQuestion(q({ difficulty: 9 }), "row"))).not.toHaveLength(0);
    expect(errors(validateQuestion(q({ guessing: 0.9 }), "row"))).not.toHaveLength(0);
  });

  it("requires an SOP link and an explanation", () => {
    expect(errors(validateQuestion(q({ sopSlug: "" }), "row"))).not.toHaveLength(0);
    expect(errors(validateQuestion(q({ explanation: "" }), "row"))).not.toHaveLength(0);
  });
});

describe("validateBank", () => {
  it("accepts a balanced bank", () => {
    expect(errors(validateBank(bank(40)))).toHaveLength(0);
  });

  it("catches the defect that actually shipped: every answer is A", () => {
    // The seeded bank had 60 questions all keyed "A", passable by choosing A
    // repeatedly. This is the regression test for that.
    const issues = validateBank(bank(40, () => ({ correctKey: "A" })));
    expect(
      errors(issues)
        .map((e) => e.message)
        .join()
    ).toMatch(/always choosing "?A/);
  });

  it("catches the other half: the same three distractors everywhere", () => {
    const issues = validateBank(
      bank(40, (i) => ({
        options: [
          { key: "A", text: `real answer ${i}` },
          { key: "B", text: "Record it informally and decide later" },
          { key: "C", text: "Skip the step when the client is familiar" },
          { key: "D", text: "Wait until month-end reporting" }
        ]
      }))
    );
    expect(
      errors(issues)
        .map((e) => e.message)
        .join()
    ).toMatch(/reused in/);
  });

  it("catches duplicate question stems", () => {
    const issues = validateBank(bank(12, () => ({ content: "Exactly the same stem every time?" })));
    expect(
      errors(issues)
        .map((e) => e.message)
        .join()
    ).toMatch(/appears \d+ times/);
  });

  it("blocks a module below the certifiable minimum", () => {
    const issues = validateBank(bank(MINIMUM_BANK_SIZE - 1));
    expect(
      errors(issues)
        .map((e) => e.message)
        .join()
    ).toMatch(/below the \d+ needed/);
  });

  it("warns, but does not block, below the target size", () => {
    const issues = validateBank(bank(20));
    expect(errors(issues)).toHaveLength(0);
    expect(issues.map((i) => i.message).join()).toMatch(/of 40 target/);
  });

  it("warns when difficulty has no spread to select against", () => {
    const issues = validateBank(bank(20, () => ({ difficulty: 0 })));
    expect(issues.map((i) => i.message).join()).toMatch(/difficulty spans/);
  });
});
