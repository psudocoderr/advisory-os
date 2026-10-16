import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, PUBLISHED_PASSWORDS, passwordProblem } from "./password-policy";

describe("passwordProblem", () => {
  it("accepts a long enough password", () => {
    expect(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it("rejects one character short of the minimum (the old form allowed 8)", () => {
    expect(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/at least 12/);
    expect(passwordProblem("eightchr")).not.toBeNull();
  });

  it("rejects the published defaults even though they are long enough", () => {
    for (const published of PUBLISHED_PASSWORDS) {
      expect(published.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
      expect(passwordProblem(published)).toMatch(/published/);
    }
  });

  it("rejects an over-long password", () => {
    expect(passwordProblem("a".repeat(129))).toMatch(/at most/);
  });
});
