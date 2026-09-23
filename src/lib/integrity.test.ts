import { describe, expect, it } from "vitest";
import {
  DEDUPE_WINDOW_MS,
  STRIKE_KINDS,
  STRIKE_LIMIT,
  isOnExamSurface,
  isRedundantEvent,
  isStrike,
  shouldTerminate,
  strikesRemaining
} from "./integrity";

/**
 * The strike policy decides whether someone's certification attempt is ended
 * and flagged. Getting it wrong in either direction is costly: too lenient and
 * it does nothing, too strict and it fails honest candidates for an accidental
 * alt-tab. These pin both edges.
 */

describe("isStrike", () => {
  it("counts leaving the exam surface", () => {
    expect(isStrike("FULLSCREEN_EXIT")).toBe(true);
    expect(isStrike("TAB_HIDDEN")).toBe(true);
  });

  it("counts deliberate attempts", () => {
    expect(isStrike("COPY")).toBe(true);
    expect(isStrike("PASTE")).toBe(true);
    expect(isStrike("CONTEXT_MENU")).toBe(true);
    expect(isStrike("DEVTOOLS_ATTEMPT")).toBe(true);
  });

  it("does not penalise returning to fullscreen", () => {
    expect(isStrike("FULLSCREEN_ENTER")).toBe(false);
  });

  it("does not double-count a tab switch via WINDOW_BLUR", () => {
    // visibilitychange and blur both fire for one alt-tab. Counting both
    // scored a single action as two strikes, which would end an attempt after
    // two ordinary actions instead of four deliberate ones.
    expect(isStrike("WINDOW_BLUR")).toBe(false);
    expect(isStrike("TAB_HIDDEN")).toBe(true);
  });

  it("excludes exactly the two non-strike kinds and no others", () => {
    expect([...STRIKE_KINDS].sort()).toEqual(
      ["FULLSCREEN_EXIT", "TAB_HIDDEN", "COPY", "PASTE", "CONTEXT_MENU", "DEVTOOLS_ATTEMPT"].sort()
    );
  });
});

describe("shouldTerminate", () => {
  it("allows exactly the limit", () => {
    expect(shouldTerminate(STRIKE_LIMIT)).toBe(false);
  });

  it("terminates strictly above the limit", () => {
    expect(shouldTerminate(STRIKE_LIMIT + 1)).toBe(true);
  });

  it("does not terminate a clean attempt", () => {
    expect(shouldTerminate(0)).toBe(false);
  });

  it("stays terminated well beyond the limit", () => {
    expect(shouldTerminate(STRIKE_LIMIT + 50)).toBe(true);
  });
});

describe("strikesRemaining", () => {
  it("reports the full allowance before any violation", () => {
    expect(strikesRemaining(0)).toBe(STRIKE_LIMIT);
  });

  it("counts down", () => {
    expect(strikesRemaining(1)).toBe(STRIKE_LIMIT - 1);
    expect(strikesRemaining(STRIKE_LIMIT)).toBe(0);
  });

  it("never goes negative", () => {
    expect(strikesRemaining(STRIKE_LIMIT + 10)).toBe(0);
  });
});

describe("isOnExamSurface", () => {
  it("is false before the candidate has entered fullscreen", () => {
    expect(isOnExamSurface(null)).toBe(false);
    expect(isOnExamSurface(undefined)).toBe(false);
  });

  it("follows the most recent fullscreen event", () => {
    expect(isOnExamSurface("FULLSCREEN_ENTER")).toBe(true);
    expect(isOnExamSurface("FULLSCREEN_EXIT")).toBe(false);
  });
});

describe("isRedundantEvent", () => {
  const now = new Date("2026-09-23T10:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("keeps a return to fullscreen that follows an exit, however quickly", () => {
    // A time window here dropped the return, leaving the server convinced
    // the candidate was still outside fullscreen.
    expect(
      isRedundantEvent("FULLSCREEN_ENTER", { latestFullscreenKind: "FULLSCREEN_EXIT", latestSameKindAt: ago(500), now })
    ).toBe(false);
  });

  it("drops a fullscreen event that repeats the current state, however late", () => {
    expect(
      isRedundantEvent("FULLSCREEN_EXIT", {
        latestFullscreenKind: "FULLSCREEN_EXIT",
        latestSameKindAt: ago(60_000),
        now
      })
    ).toBe(true);
  });

  it("records the first fullscreen entry", () => {
    expect(isRedundantEvent("FULLSCREEN_ENTER", { latestFullscreenKind: null, latestSameKindAt: null, now })).toBe(
      false
    );
  });

  it("collapses other repeats only inside the window", () => {
    const base = { latestFullscreenKind: "FULLSCREEN_ENTER" as const, now };
    expect(isRedundantEvent("TAB_HIDDEN", { ...base, latestSameKindAt: ago(DEDUPE_WINDOW_MS - 1) })).toBe(true);
    expect(isRedundantEvent("TAB_HIDDEN", { ...base, latestSameKindAt: ago(DEDUPE_WINDOW_MS + 1) })).toBe(false);
    expect(isRedundantEvent("TAB_HIDDEN", { ...base, latestSameKindAt: null })).toBe(false);
  });
});
