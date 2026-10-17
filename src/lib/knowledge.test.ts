import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { finalExamUnlocked, nextStep, trackProgress } = await import("./knowledge");

/**
 * The strict-sequence rule. Every lock in the knowledge section and the gate
 * on the topic test come from this one function, so these pin it.
 */

const topics = [
  { id: "m1", chapters: [{ id: "c1" }, { id: "c2" }] },
  { id: "m2", chapters: [{ id: "c3" }] }
];

const states = (result: ReturnType<typeof trackProgress>) => result.map((m) => m.chapters.map((c) => c.state));

describe("trackProgress", () => {
  it("opens only the first chapter of the first topic for a new trainee", () => {
    const result = trackProgress(topics, new Set(), new Set());
    expect(states(result)).toEqual([["open", "locked"], ["locked"]]);
    expect(result.map((m) => m.unlocked)).toEqual([true, false]);
    expect(result[0].testUnlocked).toBe(false);
  });

  it("opens the next chapter once the previous one is complete", () => {
    expect(states(trackProgress(topics, new Set(["c1"]), new Set()))[0]).toEqual(["complete", "open"]);
  });

  it("opens the topic test only when every chapter is complete", () => {
    const result = trackProgress(topics, new Set(["c1", "c2"]), new Set());
    expect(result[0].testUnlocked).toBe(true);
    expect(result[0].chaptersDone).toBe(2);
  });

  it("keeps the next topic locked until the badge, however many chapters are done", () => {
    const result = trackProgress(topics, new Set(["c1", "c2"]), new Set());
    expect(result[1].unlocked).toBe(false);
    expect(result[1].chapters[0].state).toBe("locked");
  });

  it("opens the next topic once the previous one is badged", () => {
    const result = trackProgress(topics, new Set(["c1", "c2"]), new Set(["m1"]));
    expect(result[1].unlocked).toBe(true);
    expect(result[1].chapters[0].state).toBe("open");
  });

  it("does not let a completion skip an earlier incomplete chapter", () => {
    // c2 complete but c1 not: c2 keeps its tick, but the test stays shut.
    const result = trackProgress(topics, new Set(["c2"]), new Set());
    expect(states(result)[0]).toEqual(["open", "complete"]);
    expect(result[0].testUnlocked).toBe(false);
  });

  it("never opens a test on a topic with no chapters", () => {
    expect(trackProgress([{ id: "m", chapters: [] }], new Set(), new Set())[0].testUnlocked).toBe(false);
  });

  it("unlocks everything for an admin preview", () => {
    const result = trackProgress(topics, new Set(), new Set(), true);
    expect(states(result)).toEqual([["open", "open"], ["open"]]);
    expect(result.every((m) => m.testUnlocked)).toBe(true);
  });
});

describe("finalExamUnlocked", () => {
  it("opens only once every topic is badged", () => {
    expect(finalExamUnlocked(trackProgress(topics, new Set(), new Set(["m1"])))).toBe(false);
    expect(finalExamUnlocked(trackProgress(topics, new Set(), new Set(["m1", "m2"])))).toBe(true);
  });

  it("stays shut on a track with no topics, even for an admin", () => {
    expect(finalExamUnlocked([], true)).toBe(false);
  });

  it("is open to admins, who preview everything", () => {
    expect(finalExamUnlocked(trackProgress(topics, new Set(), new Set(), true), true)).toBe(true);
  });
});

describe("nextStep", () => {
  const outline = {
    id: "t1",
    slug: "ops",
    topics: [
      {
        id: "m1",
        title: "One",
        slug: "one",
        module: { slug: "oe" },
        chapters: [
          { title: "Intro", slug: "intro" },
          { title: "Deep", slug: "deep" }
        ]
      },
      { id: "m2", title: "Two", slug: "two", module: { slug: "oe" }, chapters: [{ title: "Next", slug: "next" }] }
    ]
  };
  const step = (done: string[], badged: string[], certificate: "EXPERT" | null = null) => {
    const progress = trackProgress(topics, new Set(done), new Set(badged));
    return nextStep(outline, progress, finalExamUnlocked(progress), certificate);
  };

  it("points a new trainee at the first chapter", () => {
    expect(step([], [])).toEqual({ label: 'Read "Intro"', href: "/knowledge/ops/oe/one/intro" });
  });

  it("points at the next open chapter, then the topic test", () => {
    expect(step(["c1"], []).href).toBe("/knowledge/ops/oe/one/deep");
    expect(step(["c1", "c2"], [])).toEqual({ label: 'Take the "One" test', href: "/certify/m1" });
  });

  it("moves on to the next topic once badged, then the final exam, then done", () => {
    expect(step(["c1", "c2"], ["m1"]).href).toBe("/knowledge/ops/oe/two/next");
    expect(step([], ["m1", "m2"])).toEqual({ label: "Take the final exam", href: "/certify/final/t1" });
    expect(step([], ["m1", "m2"], "EXPERT").label).toBe("Certified");
  });
});
