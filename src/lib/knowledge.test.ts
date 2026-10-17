import { describe, expect, it, vi } from "vitest";
import type { BadgeLevel } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { nextStep, trackProgress } = await import("./knowledge");

/**
 * The progression rule (decisions.md 2026-10-17). Every lock in the knowledge
 * section, the gate on each topic test and the module badge come from this
 * one function, so these pin it.
 */

// Module A: topic a0 is coming soon (no chapters), a1 and a2 have chapters.
// Module B: one topic.
const modules = [
  {
    id: "A",
    topics: [
      { id: "a0", chapters: [] },
      { id: "a1", chapters: [{ id: "c1" }, { id: "c2" }] },
      { id: "a2", chapters: [{ id: "c3" }] }
    ]
  },
  { id: "B", topics: [{ id: "b1", chapters: [{ id: "c4" }] }] }
];

const badges = (entries: [string, BadgeLevel][]) => new Map<string, BadgeLevel | null>(entries);
const run = (done: string[], held: [string, BadgeLevel][] = [], admin = false) =>
  trackProgress(modules, new Set(done), badges(held), admin);
const topic = (result: ReturnType<typeof run>, id: string) => result.topics.find((t) => t.id === id)!;
const states = (result: ReturnType<typeof run>, id: string) => topic(result, id).chapters.map((c) => c.state);

describe("topics within a module", () => {
  it("opens only the first chapter of the first topic with content for a new trainee", () => {
    const result = run([]);
    expect(states(result, "a1")).toEqual(["open", "locked"]);
    expect(topic(result, "a2").unlocked).toBe(false);
    expect(topic(result, "b1").unlocked).toBe(false);
  });

  it("opens the next chapter once the previous one is complete", () => {
    expect(states(run(["c1"]), "a1")).toEqual(["complete", "open"]);
  });

  it("opens the topic test only when every chapter is complete", () => {
    expect(topic(run(["c1"]), "a1").testUnlocked).toBe(false);
    expect(topic(run(["c1", "c2"]), "a1").testUnlocked).toBe(true);
  });

  it("keeps the next topic locked until the one before it is passed", () => {
    expect(topic(run(["c1", "c2"]), "a2").unlocked).toBe(false);
    expect(topic(run(["c1", "c2"], [["a1", "PROFICIENT"]]), "a2").unlocked).toBe(true);
  });

  it("does not let a completion skip an earlier incomplete chapter", () => {
    const result = run(["c2"]);
    expect(states(result, "a1")).toEqual(["open", "complete"]);
    expect(topic(result, "a1").testUnlocked).toBe(false);
  });
});

describe("coming-soon topics", () => {
  it("shows a topic with no chapters as coming soon, never open, even for an admin", () => {
    expect(topic(run([]), "a0")).toMatchObject({ comingSoon: true, unlocked: false, testUnlocked: false });
    expect(topic(run([], [], true), "a0").unlocked).toBe(false);
  });

  it("skips it in the order and leaves it out of the module badge", () => {
    const result = run(
      [],
      [
        ["a1", "EXPERT"],
        ["a2", "PROFICIENT"]
      ]
    );
    expect(result.modules[0]).toMatchObject({ topicsCounted: 2, topicsPassed: 2, badged: true });
  });
});

describe("module badge", () => {
  it("is held only once every counted topic is passed", () => {
    expect(run([], [["a1", "EXPERT"]]).modules[0].badged).toBe(false);
  });

  it("takes the lowest topic level", () => {
    const levelWith = (held: [string, BadgeLevel][]) => run([], held).modules[0].badgeLevel;
    expect(
      levelWith([
        ["a1", "EXPERT"],
        ["a2", "SATISFACTORY"]
      ])
    ).toBe("SATISFACTORY");
    expect(
      levelWith([
        ["a1", "PROFICIENT"],
        ["a2", "EXPERT"]
      ])
    ).toBe("PROFICIENT");
  });

  it("is lost when a new topic with chapters is published, until that topic is passed", () => {
    const held: [string, BadgeLevel][] = [
      ["a1", "EXPERT"],
      ["a2", "EXPERT"]
    ];
    const grown = [
      { ...modules[0], topics: [...modules[0].topics, { id: "a3", chapters: [{ id: "c9" }] }] },
      modules[1]
    ];
    const result = trackProgress(grown, new Set(), badges(held));
    expect(result.modules[0].badged).toBe(false);
    expect(result.topics.find((t) => t.id === "a3")!.unlocked).toBe(true);
    expect(result.topics.find((t) => t.id === "b1")!.unlocked).toBe(false);
  });
});

describe("modules", () => {
  it("keeps the next module locked until the module badge", () => {
    expect(topic(run([], [["a1", "EXPERT"]]), "b1").unlocked).toBe(false);
    expect(
      topic(
        run(
          [],
          [
            ["a1", "EXPERT"],
            ["a2", "EXPERT"]
          ]
        ),
        "b1"
      ).unlocked
    ).toBe(true);
  });

  it("skips a module with nothing to pass yet", () => {
    const withEmpty = [{ id: "E", topics: [{ id: "e0", chapters: [] }] }, ...modules];
    const result = trackProgress(withEmpty, new Set(), badges([]));
    expect(result.modules[0]).toMatchObject({ topicsCounted: 0, badged: false });
    expect(result.topics.find((t) => t.id === "a1")!.unlocked).toBe(true);
  });

  it("unlocks everything with content for an admin preview", () => {
    const result = run([], [], true);
    expect(result.topics.filter((t) => !t.comingSoon).every((t) => t.unlocked && t.testUnlocked)).toBe(true);
    expect(states(result, "a1")).toEqual(["open", "open"]);
  });
});

describe("nextStep", () => {
  const outline = {
    slug: "ops",
    topics: [
      { id: "a0", title: "Zero", slug: "zero", module: { slug: "oe" }, chapters: [] },
      {
        id: "a1",
        title: "One",
        slug: "one",
        module: { slug: "oe" },
        chapters: [
          { title: "Intro", slug: "intro" },
          { title: "Deep", slug: "deep" }
        ]
      },
      { id: "a2", title: "Two", slug: "two", module: { slug: "oe" }, chapters: [{ title: "Next", slug: "next" }] },
      { id: "b1", title: "Bee", slug: "bee", module: { slug: "adv" }, chapters: [{ title: "Later", slug: "later" }] }
    ]
  };
  const step = (done: string[], held: [string, BadgeLevel][] = []) => nextStep(outline, run(done, held).topics);

  it("points a new trainee past the coming-soon topic to the first chapter", () => {
    expect(step([])).toEqual({ label: 'Read "Intro"', href: "/knowledge/ops/oe/one/intro" });
  });

  it("points at the next open chapter, then the topic test", () => {
    expect(step(["c1"]).href).toBe("/knowledge/ops/oe/one/deep");
    expect(step(["c1", "c2"])).toEqual({ label: 'Take the "One" test', href: "/certify/a1" });
  });

  it("moves on through the module, then into the next module, then done", () => {
    expect(step(["c1", "c2"], [["a1", "EXPERT"]]).href).toBe("/knowledge/ops/oe/two/next");
    expect(
      step(
        [],
        [
          ["a1", "EXPERT"],
          ["a2", "EXPERT"]
        ]
      ).href
    ).toBe("/knowledge/ops/adv/bee/later");
    expect(
      step(
        [],
        [
          ["a1", "EXPERT"],
          ["a2", "EXPERT"],
          ["b1", "EXPERT"]
        ]
      ).label
    ).toBe("Every topic passed");
  });
});
