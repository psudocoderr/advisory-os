/**
 * The certification flow through the real route handlers and finalizeSession,
 * on a real database. Only the sign-in is replaced (setup.ts).
 */
import { describe, expect, it } from "vitest";
import { POST as start } from "@/app/api/certify/start/route";
import { POST as question } from "@/app/api/certify/question/route";
import { POST as answer } from "@/app/api/certify/answer/route";
import { POST as finish } from "@/app/api/certify/finish/route";
import { POST as integrity } from "@/app/api/certify/integrity/route";
import { finalizeSession, type FinishReason } from "@/lib/certify-session";
import { IRT } from "@/lib/irt";
import { prisma } from "@/lib/prisma";
import { completeChapters, createTopic, createUser, expire, post, signIn, wrongKey, type TestUser } from "./fixtures";

type Topic = Awaited<ReturnType<typeof createTopic>>;

/** A trainee who has read the topic, signed in. */
async function readyTrainee(topic: Topic) {
  const user = await createUser();
  await completeChapters(user, topic);
  signIn(user);
  return user;
}

/** Starts the topic's test and enters fullscreen. */
async function begin(topic: Topic) {
  const started = await post(start, { topicId: topic.topicId });
  expect(started.status).toBe(200);
  const sessionId: string = started.body.sessionId;
  await post(integrity, { sessionId, kind: "FULLSCREEN_ENTER" });
  return sessionId;
}

/** Releases the current question and answers it right or wrong. */
async function answerNext(sessionId: string, correct: boolean) {
  const released = await post(question, { sessionId });
  expect(released.status).toBe(200);
  if (released.body.complete) return released;
  const item = await prisma.questionItem.findUniqueOrThrow({ where: { id: released.body.question.id } });
  return post(answer, {
    sessionId,
    questionId: item.id,
    selectedKey: correct ? item.correctKey : wrongKey(item.correctKey),
    responseTimeMs: 1000
  });
}

const session = (id: string) => prisma.testSession.findUniqueOrThrow({ where: { id } });

describe("POST /api/certify/start", () => {
  it("refuses anyone signed out", async () => {
    const topic = await createTopic();
    expect((await post(start, { topicId: topic.topicId })).status).toBe(401);
  });

  it("refuses a topic whose chapters are not all read", async () => {
    const topic = await createTopic();
    signIn(await createUser());
    expect((await post(start, { topicId: topic.topicId })).status).toBe(403);
  });

  it("refuses a topic with fewer questions than a test needs", async () => {
    const topic = await createTopic({ size: IRT.minQuestions - 1 });
    await readyTrainee(topic);
    expect((await post(start, { topicId: topic.topicId })).status).toBe(422);
  });

  it("starts an attempt, and a second Start resumes it", async () => {
    const topic = await createTopic();
    await readyTrainee(topic);
    const first = await post(start, { topicId: topic.topicId });
    const second = await post(start, { topicId: topic.topicId });
    expect(first.status).toBe(200);
    expect(second.body).toEqual({ sessionId: first.body.sessionId, resumed: true });
  });

  it("closes an expired open attempt and starts a fresh one", async () => {
    const topic = await createTopic();
    await readyTrainee(topic);
    const old = await begin(topic);
    await answerNext(old, true);
    await expire(old);

    const fresh = await post(start, { topicId: topic.topicId });
    expect(fresh.status).toBe(200);
    expect(fresh.body.sessionId).not.toBe(old);
    expect((await session(old)).status).toBe("ABANDONED");
  });

  it("holds a retake for the cooldown after a finished attempt, but not after an abandoned one", async () => {
    const topic = await createTopic();
    const user = await readyTrainee(topic);
    const failed = await begin(topic);
    for (let i = 0; i < IRT.minQuestions; i += 1) await answerNext(failed, false);
    await expire(failed);
    await post(finish, { sessionId: failed, reason: "TIMED_OUT" });
    expect((await session(failed)).status).toBe("FAILED");
    expect((await post(start, { topicId: topic.topicId })).status).toBe(429);

    // Another trainee who walks away after one question can start again.
    const other = await readyTrainee(topic);
    expect(other.id).not.toBe(user.id);
    const left = await begin(topic);
    await answerNext(left, true);
    await expire(left);
    await post(question, { sessionId: left });
    expect((await session(left)).status).toBe("ABANDONED");
    expect((await post(start, { topicId: topic.topicId })).status).toBe(200);
  });

  it("D14: parallel Starts leave one open attempt and all get its id", async () => {
    const topic = await createTopic();
    const user = await readyTrainee(topic);
    const results = await Promise.all(Array.from({ length: 6 }, () => post(start, { topicId: topic.topicId })));
    expect(results.every((result) => result.status === 200)).toBe(true);
    expect(new Set(results.map((result) => result.body.sessionId)).size).toBe(1);
    expect(await prisma.testSession.count({ where: { userId: user.id, status: "IN_PROGRESS" } })).toBe(1);
  });
});

describe("POST /api/certify/question", () => {
  it("withholds the question until the candidate is in fullscreen", async () => {
    const topic = await createTopic();
    await readyTrainee(topic);
    const { body } = await post(start, { topicId: topic.topicId });
    const refused = await post(question, { sessionId: body.sessionId });
    expect(refused).toMatchObject({ status: 409, body: { needsFullscreen: true } });
    expect((await session(body.sessionId)).timerStartedAt).toBeNull();
  });

  it("starts the clock once, never sends the answer key, and hands back the same question", async () => {
    const topic = await createTopic();
    await readyTrainee(topic);
    const sessionId = await begin(topic);

    const first = await post(question, { sessionId });
    const startedAt = (await session(sessionId)).timerStartedAt;
    const second = await post(question, { sessionId });

    expect(startedAt).not.toBeNull();
    expect((await session(sessionId)).timerStartedAt).toEqual(startedAt);
    expect(second.body.question.id).toBe(first.body.question.id);
    expect(JSON.stringify(first.body)).not.toMatch(/correctKey|explanation|difficulty/);
  });

  it("ends an expired attempt instead of releasing a question", async () => {
    const topic = await createTopic();
    await readyTrainee(topic);
    const sessionId = await begin(topic);
    await answerNext(sessionId, true);
    await expire(sessionId);
    const ended = await post(question, { sessionId });
    expect(ended.body).toMatchObject({ complete: true, result: { reason: "TIMED_OUT", abandoned: true } });
  });

  it("does not serve another trainee's attempt", async () => {
    const topic = await createTopic();
    await readyTrainee(topic);
    const sessionId = await begin(topic);
    await readyTrainee(topic);
    expect((await post(question, { sessionId })).status).toBe(404);
    expect((await post(finish, { sessionId, reason: "TIMED_OUT" })).status).toBe(404);
  });
});

describe("POST /api/certify/answer", () => {
  it("records a right answer and moves on", async () => {
    const topic = await createTopic();
    await readyTrainee(topic);
    const sessionId = await begin(topic);
    const result = await answerNext(sessionId, true);
    expect(result.body).toMatchObject({ complete: false, progress: { answered: 1 } });
    const [response] = await prisma.responseLog.findMany({ where: { sessionId } });
    expect(response.isCorrect).toBe(true);
  });

  it("accepts only the current question, and only once", async () => {
    const topic = await createTopic();
    await readyTrainee(topic);
    const sessionId = await begin(topic);
    const current = (await post(question, { sessionId })).body.question.id;
    const other = await prisma.questionItem.findFirstOrThrow({
      where: { topicId: topic.topicId, id: { not: current } }
    });
    const send = (questionId: string) =>
      post(answer, { sessionId, questionId, selectedKey: "A", responseTimeMs: 1000 });

    expect((await send(other.id)).status).toBe(409);
    expect((await send(current)).status).toBe(200);
    expect((await send(current)).status).toBe(409);
    expect(await prisma.responseLog.count({ where: { sessionId } })).toBe(1);
  });

  it("refuses an answer sent from outside fullscreen", async () => {
    const topic = await createTopic();
    await readyTrainee(topic);
    const sessionId = await begin(topic);
    const current = (await post(question, { sessionId })).body.question.id;
    await post(integrity, { sessionId, kind: "FULLSCREEN_EXIT" });
    const refused = await post(answer, { sessionId, questionId: current, selectedKey: "A", responseTimeMs: 1 });
    expect(refused).toMatchObject({ status: 409, body: { needsFullscreen: true } });
  });

  it("does not count an answer that arrives after the deadline", async () => {
    const topic = await createTopic();
    await readyTrainee(topic);
    const sessionId = await begin(topic);
    const current = (await post(question, { sessionId })).body.question.id;
    await expire(sessionId);
    const late = await post(answer, { sessionId, questionId: current, selectedKey: "A", responseTimeMs: 1 });
    expect(late.body).toMatchObject({ complete: true, result: { reason: "TIMED_OUT" } });
    expect(await prisma.responseLog.count({ where: { sessionId } })).toBe(0);
    expect((await post(answer, { sessionId, questionId: current, selectedKey: "A", responseTimeMs: 1 })).status).toBe(
      400
    );
  });
});

describe("POST /api/certify/finish", () => {
  it("refuses BANK_EXHAUSTED while questions remain, and accepts it once they are gone", async () => {
    const topic = await createTopic();
    await readyTrainee(topic);
    const sessionId = await begin(topic);
    await answerNext(sessionId, true);
    expect((await post(finish, { sessionId, reason: "BANK_EXHAUSTED" })).status).toBe(409);

    // Retired mid-attempt: nothing is left to ask.
    await prisma.questionItem.updateMany({ where: { topicId: topic.topicId }, data: { isActive: false } });
    const done = await post(finish, { sessionId, reason: "BANK_EXHAUSTED" });
    expect(done.body).toMatchObject({ complete: true, result: { reason: "BANK_EXHAUSTED" } });
  });

  it("refuses TIMED_OUT before the deadline and says how long is left", async () => {
    const topic = await createTopic();
    await readyTrainee(topic);
    const sessionId = await begin(topic);
    await answerNext(sessionId, true);
    const early = await post(finish, { sessionId, reason: "TIMED_OUT" });
    expect(early.status).toBe(409);
    expect(early.body.remainingMs).toBeGreaterThan(0);
    expect((await session(sessionId)).status).toBe("IN_PROGRESS");
  });
});

describe("POST /api/certify/integrity", () => {
  it("does not count strikes before the clock starts", async () => {
    const topic = await createTopic();
    await readyTrainee(topic);
    const { body } = await post(start, { topicId: topic.topicId });
    for (const kind of ["COPY", "PASTE", "CONTEXT_MENU", "DEVTOOLS_ATTEMPT", "TAB_HIDDEN"]) {
      expect((await post(integrity, { sessionId: body.sessionId, kind })).body.terminated).toBe(false);
    }
    expect((await session(body.sessionId)).status).toBe("IN_PROGRESS");
  });

  it("D8: a flood before the first question cannot switch enforcement off; the fourth strike ends the attempt", async () => {
    const topic = await createTopic();
    const user = await readyTrainee(topic);
    const { body } = await post(start, { topicId: topic.topicId });
    const sessionId: string = body.sessionId;
    // 200 events before the clock: the per-session cap is full, ending in fullscreen.
    await prisma.integrityEvent.createMany({
      data: Array.from({ length: 200 }, (_, i) => ({
        sessionId,
        kind: i % 2 ? ("FULLSCREEN_ENTER" as const) : ("FULLSCREEN_EXIT" as const),
        occurredAt: new Date(Date.now() - 60_000 + i)
      }))
    });
    await answerNext(sessionId, true);

    const exit = await post(integrity, { sessionId, kind: "FULLSCREEN_EXIT" });
    expect(exit.body).toMatchObject({ recorded: true, strikes: 1, terminated: false });
    const current = (await post(question, { sessionId })).status;
    expect(current).toBe(409); // out of fullscreen: no question

    let last;
    for (const kind of ["TAB_HIDDEN", "COPY", "PASTE"]) last = await post(integrity, { sessionId, kind });
    expect(last!.body).toMatchObject({ strikes: 4, terminated: true });
    expect((await session(sessionId)).status).toBe("TERMINATED");
    expect(await prisma.certification.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("finalizeSession", () => {
  /** An open attempt with `answered` stored answers, all right or all wrong. */
  async function openAttempt(answered: number, correct: boolean) {
    const topic = await createTopic();
    const user = await createUser();
    const testSession = await prisma.testSession.create({
      data: { userId: user.id, trackId: topic.trackId, topicId: topic.topicId, timerStartedAt: new Date() }
    });
    const items = await prisma.questionItem.findMany({ where: { topicId: topic.topicId }, take: answered });
    await prisma.responseLog.createMany({
      data: items.map((item) => ({
        sessionId: testSession.id,
        questionId: item.id,
        selectedKey: correct ? item.correctKey : wrongKey(item.correctKey),
        isCorrect: correct,
        responseTimeMs: 1000,
        abilityAfter: 0,
        seAfter: 1
      }))
    });
    return { user, topic, sessionId: testSession.id };
  }

  const finalize = (
    attempt: { user: TestUser; sessionId: string },
    theta: number,
    se: number,
    answered: number,
    reason: FinishReason
  ) => finalizeSession({ sessionId: attempt.sessionId, userId: attempt.user.id, theta, se, answered, reason });

  const audits = (sessionId: string) =>
    prisma.auditLog.findMany({ where: { entity: "TestSession", entityId: sessionId } });

  it.each([
    ["PASSED", "PASS", true, 2, 0.2, 10, "STOP_RULE"],
    ["FAILED", "FAIL", false, -1, 0.3, 10, "STOP_RULE"],
    ["INCONCLUSIVE", "INCONCLUSIVE", true, 0.6, 0.3, 10, "BANK_EXHAUSTED"],
    ["ABANDONED", "ABANDON", true, 2, 0.5, 3, "TIMED_OUT"],
    ["TERMINATED", "TERMINATE", true, 2, 0.2, 10, "INTEGRITY_TERMINATED"]
  ] as const)("ends as %s with one %s audit entry", async (status, action, correct, theta, se, answered, reason) => {
    const attempt = await openAttempt(answered, correct);
    await finalize(attempt, theta, se, answered, reason);
    const stored = await session(attempt.sessionId);
    expect(stored.status).toBe(status);
    expect(stored.completedAt).not.toBeNull();
    expect((await audits(attempt.sessionId)).map((row) => row.action)).toEqual([action]);
    const badges = await prisma.certification.findMany({ where: { userId: attempt.user.id } });
    expect(badges.map((badge) => badge.badgeLevel)).toEqual(status === "PASSED" ? ["EXPERT"] : []);
    expect(stored.certified).toBe(status === "PASSED");
  });

  it("is idempotent: a second call reports the stored result and issues nothing", async () => {
    const attempt = await openAttempt(10, true);
    const first = await finalize(attempt, 2, 0.2, 10, "STOP_RULE");
    const again = await finalize(attempt, -2, 0.2, 10, "TIMED_OUT");
    expect(again).toMatchObject({ passed: true, level: first.level });
    expect(await audits(attempt.sessionId)).toHaveLength(1);
    expect(await prisma.certification.count({ where: { userId: attempt.user.id } })).toBe(1);
  });

  it("D3: a passing finish racing a termination leaves one consistent ending", async () => {
    for (let round = 0; round < 10; round += 1) {
      const attempt = await openAttempt(10, true);
      await Promise.allSettled([
        finalize(attempt, 2, 0.2, 10, "STOP_RULE"),
        finalize(attempt, 2, 0.2, 10, "INTEGRITY_TERMINATED")
      ]);
      const stored = await session(attempt.sessionId);
      const badges = await prisma.certification.count({ where: { userId: attempt.user.id } });
      expect(await audits(attempt.sessionId)).toHaveLength(1);
      expect(badges).toBe(stored.status === "PASSED" ? 1 : 0);
      expect(["PASSED", "TERMINATED"]).toContain(stored.status);
    }
  });

  it("keeps the best level: a lower pass does not replace a higher badge", async () => {
    const first = await openAttempt(10, true);
    await finalize(first, 2, 0.2, 10, "STOP_RULE"); // Expert
    const retake = await prisma.testSession.create({
      data: {
        userId: first.user.id,
        trackId: first.topic.trackId,
        topicId: first.topic.topicId,
        timerStartedAt: new Date(),
        attemptNumber: 2
      }
    });
    const items = await prisma.questionItem.findMany({ where: { topicId: first.topic.topicId }, take: 10 });
    await prisma.responseLog.createMany({
      data: items.map((item) => ({
        sessionId: retake.id,
        questionId: item.id,
        selectedKey: item.correctKey,
        isCorrect: true,
        responseTimeMs: 1000,
        abilityAfter: 0,
        seAfter: 1
      }))
    });
    const result = await finalize({ user: first.user, sessionId: retake.id }, 1.0, 0.2, 10, "STOP_RULE");
    expect(result).toMatchObject({ passed: true, level: "Satisfactory" });
    const badges = await prisma.certification.findMany({ where: { userId: first.user.id } });
    expect(badges.map((badge) => [badge.badgeLevel, badge.sessionId])).toEqual([["EXPERT", first.sessionId]]);
  });
});
