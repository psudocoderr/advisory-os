/**
 * Server actions (src/lib/actions.ts) on a real database: who may call each
 * one, whose records it may touch, and what it refuses. Advisor A owns the
 * records; advisor B tries them with A's ids, as a tampered form post would.
 */
import { beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import * as actions from "@/lib/actions";
import { prisma } from "@/lib/prisma";
import {
  createClientFor,
  createProspectFor,
  createTopic,
  createUser,
  form,
  identifiers,
  redirectedTo,
  signIn,
  type TestUser
} from "./fixtures";

const today = new Date().toISOString().slice(0, 10);
const NONE = {}; // the previous FormState, which the actions ignore

let a: TestUser;
let b: TestUser;
let admin: TestUser;

beforeEach(async () => {
  [a, b, admin] = [await createUser(), await createUser(), await createUser("ADMIN")];
});

const audits = () => prisma.auditLog.count();

describe("records belong to their advisor", () => {
  const planFields = (clientId: string) => ({
    clientId,
    planType: "SIP",
    amount: 5000,
    frequency: "MONTHLY",
    goal: "RETIREMENT",
    status: "DRAFT"
  });
  const reviewFields = (clientId: string) => ({
    clientId,
    reviewDate: today,
    currentAum: 999999,
    returns: 5,
    actions: "Rebalanced the portfolio",
    nextReviewDate: today
  });

  it("another advisor cannot change a prospect's stage; an admin can", async () => {
    const prospect = await createProspectFor(a);
    signIn(b);
    await expect(actions.updateProspectStage(form({ id: prospect.id, stage: "DROPPED" }))).rejects.toThrow();
    expect((await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } })).stage).toBe("LEAD");

    signIn(admin);
    await actions.updateProspectStage(form({ id: prospect.id, stage: "MEETING_HELD" }));
    expect((await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } })).stage).toBe("MEETING_HELD");
  });

  it("another advisor cannot onboard a prospect", async () => {
    const prospect = await createProspectFor(a);
    signIn(b);
    const result = await actions.onboardProspect(
      NONE,
      form({ prospectId: prospect.id, pan: identifiers().pan, kycStatus: "VERIFIED", aum: 1000, onboardingDate: today })
    );
    expect(result).toEqual({ error: "Prospect not found" });
    expect(await prisma.client.count()).toBe(0);
  });

  it("onboarding keeps the prospect's advisor and closes the prospect", async () => {
    const prospect = await createProspectFor(a);
    signIn(admin);
    const result = await actions.onboardProspect(
      NONE,
      form({ prospectId: prospect.id, pan: identifiers().pan, kycStatus: "VERIFIED", aum: 1000, onboardingDate: today })
    );
    expect(result.ok).toBeDefined();
    const client = await prisma.client.findFirstOrThrow();
    expect(client.assignedToId).toBe(a.id);
    expect((await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } })).stage).toBe("ONBOARDED");
  });

  it("another advisor cannot change a client's KYC", async () => {
    const client = await createClientFor(a);
    signIn(b);
    await expect(actions.updateClientKyc(form({ id: client.id, kycStatus: "EXPIRED" }))).rejects.toThrow();
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).kycStatus).toBe("PENDING");
  });

  it("another advisor cannot add a plan for a client, or change a plan's status", async () => {
    const client = await createClientFor(a);
    signIn(b);
    expect(await actions.createPlan(NONE, form(planFields(client.id)))).toEqual({ error: "Client not found" });

    signIn(a);
    expect((await actions.createPlan(NONE, form(planFields(client.id)))).ok).toBeDefined();
    const plan = await prisma.investmentPlan.findFirstOrThrow();

    signIn(b);
    await expect(actions.updatePlanStatus(form({ id: plan.id, status: "CLOSED" }))).rejects.toThrow("Plan not found");
    expect((await prisma.investmentPlan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("DRAFT");
  });

  it("another advisor cannot add a review, which would overwrite the client's AUM", async () => {
    const client = await createClientFor(a);
    signIn(b);
    expect(await actions.createReview(NONE, form(reviewFields(client.id)))).toEqual({ error: "Client not found" });
    expect(Number((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).aum)).toBe(100000);

    signIn(admin);
    expect((await actions.createReview(NONE, form(reviewFields(client.id)))).ok).toBeDefined();
    expect(Number((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).aum)).toBe(999999);
  });

  it("another advisor cannot log a meeting against a prospect or client", async () => {
    const [prospect, client] = [await createProspectFor(a), await createClientFor(a)];
    const meeting = (party: string) =>
      actions.createMeeting(NONE, form({ party, summary: "Catch-up call", meetingDate: today }));
    signIn(b);
    expect(await meeting(`prospect:${prospect.id}`)).toEqual({ error: "Prospect not found" });
    expect(await meeting(`client:${client.id}`)).toEqual({ error: "Client not found" });
    expect(await prisma.meetingLog.count()).toBe(0);

    signIn(a);
    expect((await meeting(`client:${client.id}`)).ok).toBeDefined();
  });

  it("a new record is assigned to whoever creates it, whatever the form says", async () => {
    signIn(b);
    const { phone } = identifiers();
    const result = await actions.createProspect(
      NONE,
      form({ name: "Tampered", phone, source: "EVENT", stage: "LEAD", firstContactDate: today, assignedToId: a.id })
    );
    expect(result.ok).toBeDefined();
    expect((await prisma.prospect.findFirstOrThrow()).assignedToId).toBe(b.id);
  });

  it("signed-out calls go to the login page and change nothing", async () => {
    const prospect = await createProspectFor(a);
    signIn(null);
    expect(await redirectedTo(actions.updateProspectStage(form({ id: prospect.id, stage: "DROPPED" })))).toBe("/login");
    expect(await redirectedTo(actions.createProspect(NONE, form({})))).toBe("/login");
    expect((await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } })).stage).toBe("LEAD");
  });
});

describe("admin-only actions refuse advisors and signed-out callers", () => {
  async function adminOnlyCalls() {
    const topic = await createTopic({ size: 0 });
    const trackModule = await prisma.module.findFirstOrThrow({ where: { topics: { some: { id: topic.topicId } } } });
    return [
      [
        "createQuestionItem",
        () =>
          actions.createQuestionItem(
            NONE,
            form({
              chapterId: topic.chapterId,
              content: "A question long enough?",
              optionA: "a",
              optionB: "b",
              optionC: "c",
              optionD: "d",
              correctKey: "A",
              explanation: "Because it is."
            })
          )
      ],
      ["saveTrack", () => actions.saveTrack(NONE, form({ title: "New track" }))],
      ["saveTopic", () => actions.saveTopic(NONE, form({ moduleId: trackModule.id, title: "New topic" }))],
      ["deleteTopic", () => actions.deleteTopic(NONE, form({ id: topic.topicId, confirm: "topic" }))],
      ["deleteModule", () => actions.deleteModule(NONE, form({ id: trackModule.id }))],
      ["createChapter", () => actions.createChapter(NONE, form({ topicId: topic.topicId, title: "New chapter" }))],
      ["saveChapter", () => actions.saveChapter(NONE, form({ id: topic.chapterId, title: "Renamed", body: "x" }))],
      [
        "moveKnowledgeItem",
        () => actions.moveKnowledgeItem(form({ kind: "topic", id: topic.topicId, direction: "up" }))
      ],
      [
        "createUser",
        () =>
          actions.createUser(
            form({ name: "Intruder", email: "new@test.local", password: "long enough pass", role: "ADMIN" })
          )
      ],
      ["updateUserActive", () => actions.updateUserActive(form({ id: a.id, isActive: "false" }))]
    ] as const;
  }

  it.each([
    ["an advisor", "/dashboard"],
    ["a signed-out caller", "/login"]
  ])("%s is redirected to %s by every one, and nothing changes", async (who, target) => {
    const calls = await adminOnlyCalls();
    const before = {
      audits: await audits(),
      users: await prisma.user.count(),
      topics: await prisma.topic.count(),
      chapters: await prisma.chapter.findMany({ select: { title: true } })
    };
    signIn(who === "an advisor" ? a : null);
    for (const [name, call] of calls) {
      expect(await redirectedTo(call()), name).toBe(target);
    }
    expect(await audits()).toBe(before.audits);
    expect(await prisma.user.count()).toBe(before.users);
    expect(await prisma.topic.count()).toBe(before.topics);
    expect(await prisma.chapter.findMany({ select: { title: true } })).toEqual(before.chapters);
    expect(await prisma.questionItem.count()).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).isActive).toBe(true);
  });
});

describe("validation", () => {
  it("explains a bad mobile number and a short name in words", async () => {
    signIn(a);
    const fields = { name: "Valid Name", phone: "12345", source: "EVENT", stage: "LEAD", firstContactDate: today };
    expect(await actions.createProspect(NONE, form(fields))).toEqual({
      error: "Indian mobile numbers are 10 digits starting with 6, 7, 8 or 9"
    });
    expect(await actions.createProspect(NONE, form({ ...fields, name: "X", phone: identifiers().phone }))).toEqual({
      error: "Name: must be at least 2 characters"
    });
  });

  it("explains an invalid date instead of failing (O12)", async () => {
    signIn(a);
    const prospect = { name: "Valid Name", phone: identifiers().phone, source: "EVENT", stage: "LEAD" };
    expect(await actions.createProspect(NONE, form({ ...prospect, firstContactDate: "31/13/2026" }))).toEqual({
      error: "First contact date: enter a valid date"
    });
    expect(
      await actions.createProspect(NONE, form({ ...prospect, firstContactDate: today, followUpDate: "soon" }))
    ).toEqual({ error: "Follow-up date: enter a valid date" });
    expect(await prisma.prospect.count()).toBe(0);
  });

  it("refuses a second prospect or client with the same mobile number or PAN", async () => {
    signIn(a);
    const { phone, pan } = identifiers();
    const prospect = { name: "First", phone, source: "EVENT", stage: "LEAD", firstContactDate: today };
    expect((await actions.createProspect(NONE, form(prospect))).ok).toBeDefined();
    expect(await actions.createProspect(NONE, form({ ...prospect, name: "Second" }))).toEqual({
      error: "A prospect with this mobile number already exists"
    });

    const client = { name: "First", phone, pan, kycStatus: "VERIFIED", aum: 1000, onboardingDate: today };
    expect((await actions.createClient(NONE, form(client))).ok).toBeDefined();
    signIn(b); // uniqueness is across advisors, not per advisor
    expect(await actions.createClient(NONE, form({ ...client, phone: identifiers().phone }))).toEqual({
      error: "A client with this PAN already exists"
    });
    expect(await actions.createClient(NONE, form({ ...client, pan: identifiers().pan }))).toEqual({
      error: "A client with this mobile number already exists"
    });
  });

  it("two clients saved at once with one PAN: one is created, the other gets the message, nothing throws", async () => {
    signIn(a);
    for (let round = 0; round < 5; round += 1) {
      const { pan } = identifiers();
      const results = await Promise.all(
        [0, 1].map(() =>
          actions.createClient(
            NONE,
            form({
              name: "Racer",
              phone: identifiers().phone,
              pan,
              kycStatus: "PENDING",
              aum: 1,
              onboardingDate: today
            })
          )
        )
      );
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => result.error)).toEqual([{ error: "A client with this PAN already exists" }]);
    }
  });

  it("an admin cannot create an account with a short or published password, and the stored one is hashed", async () => {
    signIn(admin);
    const user = (password: string, email: string) =>
      actions.createUser(form({ name: "New person", email, password, role: "ADVISOR" }));
    await expect(user("short", "one@test.local")).rejects.toThrow("Use at least");
    await expect(user("ChangeMeAdmin123!", "two@test.local")).rejects.toThrow("published");
    await expect(user("a long enough passphrase", "not an email")).rejects.toThrow("Invalid email");
    await user("a long enough passphrase", "  Three@Test.local ");
    const created = await prisma.user.findUniqueOrThrow({ where: { email: "three@test.local" } });
    expect(created.passwordHash).not.toContain("passphrase");
    expect(await bcrypt.compare("a long enough passphrase", created.passwordHash)).toBe(true);
    await expect(user("another long passphrase", "three@test.local")).rejects.toThrow("already exists");
  });

  it("an admin cannot deactivate their own account", async () => {
    signIn(admin);
    await expect(actions.updateUserActive(form({ id: admin.id, isActive: "false" }))).rejects.toThrow(
      "cannot deactivate your own"
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).isActive).toBe(true);
  });

  it("a question takes its topic from its chapter, not from the form", async () => {
    const [first, second] = [await createTopic({ size: 0 }), await createTopic({ size: 0 })];
    signIn(admin);
    await actions.createQuestionItem(
      NONE,
      form({
        chapterId: first.chapterId,
        topicId: second.topicId,
        content: "Which topic am I in?",
        optionA: "a",
        optionB: "b",
        optionC: "c",
        optionD: "d",
        correctKey: "B",
        explanation: "The chapter decides."
      })
    );
    expect((await prisma.questionItem.findFirstOrThrow()).topicId).toBe(first.topicId);
  });

  it("deleting a topic needs its slug typed exactly", async () => {
    const topic = await createTopic({ size: 3 });
    signIn(admin);
    expect(await actions.deleteTopic(NONE, form({ id: topic.topicId, confirm: "wrong" }))).toEqual({
      error: "Type topic to confirm"
    });
    expect(await prisma.topic.count()).toBe(1);
    expect((await actions.deleteTopic(NONE, form({ id: topic.topicId, confirm: "topic" }))).ok).toBeDefined();
    expect(await prisma.topic.count()).toBe(0);
    expect(await prisma.questionItem.count()).toBe(0);
  });
});

describe("markChapterComplete", () => {
  it("opens chapters one at a time and refuses a locked or unpublished one", async () => {
    const topic = await createTopic({ size: 0 });
    const second = await prisma.chapter.create({
      data: { topicId: topic.topicId, slug: "second", title: "Second", order: 2, isPublished: true }
    });
    const draft = await prisma.chapter.create({
      data: { topicId: topic.topicId, slug: "draft", title: "Draft", order: 3 }
    });
    const mark = (chapterId: string) => actions.markChapterComplete(form({ chapterId }));
    signIn(a);

    await expect(mark(second.id)).rejects.toThrow("locked");
    await expect(mark(draft.id)).rejects.toThrow("Chapter not found");
    await mark(topic.chapterId);
    await mark(topic.chapterId); // twice is harmless
    await mark(second.id);
    expect(await prisma.chapterCompletion.count({ where: { userId: a.id } })).toBe(2);
  });

  it("refuses a chapter in a topic that is not open yet", async () => {
    const first = await createTopic({ size: 0 });
    const trackModule = await prisma.module.findFirstOrThrow({ where: { topics: { some: { id: first.topicId } } } });
    const later = await prisma.topic.create({
      data: { moduleId: trackModule.id, slug: "later", title: "Later", order: 1 }
    });
    const chapter = await prisma.chapter.create({
      data: { topicId: later.id, slug: "c", title: "C", order: 1, isPublished: true }
    });
    signIn(a);
    await expect(actions.markChapterComplete(form({ chapterId: chapter.id }))).rejects.toThrow("locked");
  });
});

describe("adding a question in the editor", () => {
  const fields = (chapterId: string, over: Record<string, string | number> = {}) => ({
    chapterId,
    content: `A distinct question ${Math.random()}?`,
    optionA: "first answer",
    optionB: "second answer",
    optionC: "third answer",
    optionD: "fourth answer",
    correctKey: "A",
    explanation: "Because it is so.",
    difficulty: 0,
    ...over
  });
  /** Puts `keys.length` questions straight into the topic's bank. */
  const seed = (topic: { topicId: string; chapterId: string }, keys: string[], difficulty = (i: number) => i * 0.3) =>
    prisma.questionItem.createMany({
      data: keys.map((correctKey, i) => ({
        topicId: topic.topicId,
        chapterId: topic.chapterId,
        content: `Seeded question ${i}?`,
        options: ["A", "B", "C", "D"].map((key) => ({ key, text: `${key} ${i}` })),
        correctKey,
        explanation: "Seeded.",
        difficulty: difficulty(i),
        createdById: admin.id
      }))
    });

  it("shows the question's own problem and adds nothing", async () => {
    const topic = await createTopic({ size: 0 });
    signIn(admin);
    expect(await actions.createQuestionItem(NONE, form(fields(topic.chapterId, { optionD: "First Answer" })))).toEqual({
      error: "Options are not all distinct"
    });
    expect(await actions.createQuestionItem(NONE, form(fields(topic.chapterId, { difficulty: 3.5 })))).toEqual({
      error: "Difficulty 3.5 is outside the usable range -3 to 3"
    });
    expect(await prisma.questionItem.count()).toBe(0);
  });

  it("lets a bank be built one question at a time, below the minimum size", async () => {
    const topic = await createTopic({ size: 0 });
    signIn(admin);
    for (const key of ["A", "B", "C"]) {
      expect(
        (await actions.createQuestionItem(NONE, form(fields(topic.chapterId, { correctKey: key })))).ok
      ).toBeDefined();
    }
    expect(await prisma.questionItem.count()).toBe(3);
    // No guessing value sent: the one default, as the schema and import template use (O16).
    expect((await prisma.questionItem.findFirstOrThrow()).guessing).toBe(0.25);
  });

  it("refuses a question that would make the answer key passable by always choosing one letter", async () => {
    const topic = await createTopic({ size: 0 });
    await seed(topic, ["A", "A", "A", "A", "A", "B", "C"]);
    signIn(admin);
    const result = await actions.createQuestionItem(NONE, form(fields(topic.chapterId, { correctKey: "A" })));
    expect(result.error).toMatch(/75% of correct answers are "A".*always choosing A/);
    expect(await prisma.questionItem.count({ where: { topicId: topic.topicId } })).toBe(7);
  });

  it("refuses a repeated question", async () => {
    const topic = await createTopic({ size: 0 });
    await seed(topic, ["A", "B"]);
    signIn(admin);
    const result = await actions.createQuestionItem(
      NONE,
      form(fields(topic.chapterId, { content: "seeded QUESTION 1?" }))
    );
    expect(result.error).toMatch(/^The same question appears 2 times/);
  });

  it("refuses the question that would leave a bank a perfect candidate cannot pass", async () => {
    const topic = await createTopic({ size: 0 });
    await seed(topic, ["A", "B", "C", "D", "A", "B", "C", "D", "A"], (i) => -2 + i * 0.15);
    signIn(admin);
    const easy = await actions.createQuestionItem(
      NONE,
      form(fields(topic.chapterId, { correctKey: "B", difficulty: -0.5 }))
    );
    expect(easy.error).toMatch(/answers every question correctly does not pass/);
    expect(await prisma.questionItem.count({ where: { topicId: topic.topicId } })).toBe(9);
  });

  it("does not blame a new question for a problem the bank already has", async () => {
    const topic = await createTopic({ size: 0 });
    await seed(topic, Array(9).fill("A"));
    signIn(admin);
    const result = await actions.createQuestionItem(NONE, form(fields(topic.chapterId, { correctKey: "B" })));
    expect(result.ok).toBeDefined();
  });
});

describe("plan status changes (O22)", () => {
  async function plan(status: "DRAFT" | "SENT" | "ACCEPTED" | "ACTIVE" | "CLOSED") {
    const client = await createClientFor(a);
    return prisma.investmentPlan.create({
      data: {
        clientId: client.id,
        planType: "SIP",
        amount: 1000,
        frequency: "MONTHLY",
        goal: "WEALTH",
        notes: "",
        status
      }
    });
  }
  const move = (id: string, status: string) => actions.updatePlanStatus(form({ id, status }));
  const stored = (id: string) => prisma.investmentPlan.findUniqueOrThrow({ where: { id } });

  it("moves forward and fills the dates; pulling back to draft clears the sent date", async () => {
    const p = await plan("DRAFT");
    signIn(a);
    await move(p.id, "SENT");
    expect((await stored(p.id)).sentDate).not.toBeNull();
    await move(p.id, "DRAFT");
    expect(await stored(p.id)).toMatchObject({ status: "DRAFT", sentDate: null });
    await move(p.id, "SENT");
    await move(p.id, "ACCEPTED");
    await move(p.id, "ACTIVE");
    await move(p.id, "CLOSED");
    const done = await stored(p.id);
    expect(done.status).toBe("CLOSED");
    expect(done.acceptedDate).not.toBeNull();
  });

  it.each([
    ["CLOSED", "SENT"],
    ["ACTIVE", "DRAFT"],
    ["DRAFT", "ACTIVE"],
    ["ACCEPTED", "SENT"]
  ] as const)("refuses %s to %s and changes nothing", async (from, to) => {
    const p = await plan(from);
    signIn(a);
    await expect(move(p.id, to)).rejects.toThrow("cannot become");
    expect((await stored(p.id)).status).toBe(from);
    expect(await prisma.auditLog.count({ where: { entityId: p.id } })).toBe(0);
  });

  it("choosing the status it already has does nothing", async () => {
    const p = await plan("SENT");
    signIn(a);
    await move(p.id, "SENT");
    expect(await prisma.auditLog.count({ where: { entityId: p.id } })).toBe(0);
  });
});
