import { describe, expect, it } from "vitest";
import {
  DEDUPE_WINDOW_MS,
  STRIKE_KINDS,
  INTEGRITY_KINDS,
  STRIKE_LIMIT,
  isCappable,
  isOnExamSurface,
  isRedundantEvent,
  isStrike,
  shouldTerminate,
  countStrikes,
  type IntegrityKind
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

describe("isCappable", () => {
  it("lets the cap drop anything before the clock starts", () => {
    for (const kind of INTEGRITY_KINDS) expect(isCappable(kind, false)).toBe(true);
  });

  it("never drops a fullscreen or strike event once the clock runs (D8)", () => {
    // A cap filled before the first question must not freeze the fullscreen
    // state or hide strikes for the rest of the attempt.
    expect(isCappable("FULLSCREEN_EXIT", true)).toBe(false);
    expect(isCappable("FULLSCREEN_ENTER", true)).toBe(false);
    for (const kind of STRIKE_KINDS) expect(isCappable(kind, true)).toBe(false);
  });

  it("still caps the informational blur once the clock runs", () => {
    expect(isCappable("WINDOW_BLUR", true)).toBe(true);
  });
});

describe("countStrikes (D6: one time away counts once)", () => {
  const at = (seconds: number) => new Date(Date.UTC(2026, 9, 19, 10, 0, seconds));
  const strikes = (...events: [IntegrityKind, number][]) =>
    countStrikes(events.map(([kind, seconds]) => ({ kind, occurredAt: at(seconds) })));

  it("counts leaving fullscreen, and nothing more until the return", () => {
    expect(strikes(["FULLSCREEN_EXIT", 0], ["TAB_HIDDEN", 5], ["COPY", 9], ["DEVTOOLS_ATTEMPT", 20])).toBe(1);
  });

  it("merges a tab switch straight from fullscreen, in either order", () => {
    expect(strikes(["TAB_HIDDEN", 0], ["FULLSCREEN_EXIT", 1])).toBe(1);
    expect(strikes(["FULLSCREEN_EXIT", 0], ["TAB_HIDDEN", 1])).toBe(1);
  });

  it("counts every leave after a return, however quick", () => {
    expect(strikes(["FULLSCREEN_EXIT", 0], ["FULLSCREEN_ENTER", 1], ["FULLSCREEN_EXIT", 2])).toBe(2);
  });

  it("counts each act on the exam surface", () => {
    expect(strikes(["COPY", 0], ["PASTE", 1], ["CONTEXT_MENU", 2])).toBe(3);
    // A strike on the surface and a later separate exit are two.
    expect(strikes(["COPY", 0], ["FULLSCREEN_EXIT", 10])).toBe(2);
  });

  it("does not count a window blur or a return", () => {
    expect(strikes(["WINDOW_BLUR", 0], ["FULLSCREEN_ENTER", 1])).toBe(0);
  });
});
