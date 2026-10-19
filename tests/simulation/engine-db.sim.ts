/**
 * Simulation cases 5 and 8 (flags.md D15), through the real route handlers,
 * finalizeSession, the result page and the admin CSV, on a local database.
 *
 * Only the sign-in is faked: `getServerSession` returns whoever `as()` set.
 * Everything else is the code production runs. Time-outs are made by moving
 * `timerStartedAt` back, which is what 20 minutes passing looks like to the
 * server.
 *
 * Needs a migrated, disposable local database whose name starts with `mt_`;
 * it is wiped at the start. Skipped otherwise. Run:
 *   LOCAL_DB_NAME=mt_sim ~/.cache/advisory-os-localdb/local.sh npm run test:sim
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

let current: Session | null = null;
vi.mock("next-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth")>()),
  getServerSession: vi.fn(async () => current)
}));

const url = process.env.DATABASE_URL ?? "";
const disposable = /^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\/mt_\w+$/.test(url);

// Imported after the mock and only on a disposable database, so a run
// without one never opens a connection.
const app = disposable
  ? {
      prisma: (await import("@/lib/prisma")).prisma,
      irt: await import("@/lib/irt"),
      start: (await import("@/app/api/certify/start/route")).POST,
      question: (await import("@/app/api/certify/question/route")).POST,
      answer: (await import("@/app/api/certify/answer/route")).POST,
      finish: (await import("@/app/api/certify/finish/route")).POST,
      integrity: (await import("@/app/api/certify/integrity/route")).POST,
      report: (await import("@/app/api/reports/[userId]/route")).GET,
      ResultPage: (await import("@/app/(app)/certify/session/[sessionId]/page")).default
    }
  : null;

type User = { id: string; role: "ADMIN" | "ADVISOR"; name: string; email: string };
const as = (user: User) => {
  current = { user, expires: new Date(Date.now() + 3600_000).toISOString() } as Session;
};
const post = async (handler: (request: Request) => Promise<Response>, body: unknown) => {
  const response = await handler(new Request("http://local.test/api", { method: "POST", body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
};

const KEYS = ["A", "B", "C", "D"];
const STATUS = { PASS: "PASSED", FAIL: "FAILED", INCONCLUSIVE: "INCONCLUSIVE" } as const;

describe.skipIf(!disposable)("D15 on a local database", () => {
  // The body still runs when skipped, so no non-null assertion here.
  const { prisma, irt } = app ?? ({} as NonNullable<typeof app>);
  let admin: User;
  /** Topic with 40 questions over -2.5..2.5: long runs, every level reachable. */
  let main: { trackId: string; topicId: string; chapterId: string };
  /** Topic with 12 questions over -2..-0.5: a perfect run is INCONCLUSIVE (D15.1). */
  let easy: { trackId: string; topicId: string; chapterId: string };

  async function topicWithBank(order: number, size: number, from: number, to: number) {
    const track = await prisma.track.create({ data: { slug: `t${order}`, title: `Track ${order}`, order } });
    const mod = await prisma.module.create({
      data: { trackId: track.id, slug: "m", title: `Module ${order}`, order: 1 }
    });
    const topic = await prisma.topic.create({
      data: { moduleId: mod.id, slug: "topic", title: `Topic ${order}`, order: 0 }
    });
    const chapter = await prisma.chapter.create({
      data: { topicId: topic.id, slug: "chapter", title: `Chapter ${order}`, order: 1, isPublished: true }
    });
    await prisma.questionItem.createMany({
      data: Array.from({ length: size }, (_, i) => ({
        topicId: topic.id,
        chapterId: chapter.id,
        content: `Question ${order}.${i}?`,
        options: KEYS.map((key) => ({ key, text: `${key}${i}` })),
        correctKey: KEYS[i % 4],
        explanation: "Because.",
        difficulty: from + ((to - from) * i) / (size - 1),
        createdById: admin.id
      }))
    });
    return { trackId: track.id, topicId: topic.id, chapterId: chapter.id };
  }

  beforeAll(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
    const row = await prisma.user.create({
      data: { email: "admin@sim.local", name: "Admin", passwordHash: "x", role: "ADMIN" }
    });
    admin = { id: row.id, role: "ADMIN", name: row.name, email: row.email };
    main = await topicWithBank(1, 40, -2.5, 2.5);
    easy = await topicWithBank(2, 12, -2, -0.5);
  });

  let trainees = 0;
  /** A new trainee who has read the chapters of both topics. */
  async function trainee(): Promise<User> {
    trainees += 1;
    const row = await prisma.user.create({
      data: { email: `t${trainees}@sim.local`, name: `Trainee ${trainees}`, passwordHash: "x" }
    });
    await prisma.chapterCompletion.createMany({
      data: [main.chapterId, easy.chapterId].map((chapterId) => ({ userId: row.id, chapterId }))
    });
    return { id: row.id, role: "ADVISOR", name: row.name, email: row.email };
  }

  async function start(user: User, topicId: string) {
    as(user);
    return post(app!.start, { topicId });
  }

  /**
   * Starts a test and answers `count` questions (or until it ends), choosing
   * right or wrong per `correct`. Returns the session and the final response.
   */
  async function sit(
    user: User,
    topicId: string,
    correct: (n: number) => boolean,
    count = Infinity
  ): Promise<{ sessionId: string; last: Awaited<ReturnType<typeof post>> | null }> {
    const started = await start(user, topicId);
    expect(started.status).toBe(200);
    const sessionId: string = started.body.sessionId;
    await post(app!.integrity, { sessionId, kind: "FULLSCREEN_ENTER" });
    let last = null;
    for (let n = 0; n < count; n += 1) {
      const released = await post(app!.question, { sessionId });
      if (released.body.complete) return { sessionId, last: released };
      const q = await prisma.questionItem.findUniqueOrThrow({ where: { id: released.body.question.id } });
      const wrong = KEYS.find((key) => key !== q.correctKey)!;
      last = await post(app!.answer, {
        sessionId,
        questionId: q.id,
        selectedKey: correct(n) ? q.correctKey : wrong,
        responseTimeMs: 1000
      });
      expect(last.status).toBe(200);
      if (last.body.complete) break;
    }
    return { sessionId, last };
  }

  /** What 21 minutes passing looks like to the server. */
  const expire = (sessionId: string) =>
    prisma.testSession.update({
      where: { id: sessionId },
      data: { timerStartedAt: new Date(Date.now() - (irt.IRT.timeLimitMinutes + 1) * 60_000) }
    });

  // --- 5. Short attempts --------------------------------------------------

  describe("D15.5 short attempts", () => {
    it("a time-out below the minimum is ABANDONED: no fail, no badge, no cooldown", async () => {
      const user = await trainee();
      const { sessionId } = await sit(user, main.topicId, () => true, 3);
      await expire(sessionId);

      const ended = await post(app!.question, { sessionId });
      expect(ended.body).toMatchObject({ complete: true, result: { abandoned: true, reason: "TIMED_OUT" } });

      const stored = await prisma.testSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(stored.status).toBe("ABANDONED");
      expect(stored.certified).toBe(false);
      expect(await prisma.certification.count({ where: { userId: user.id } })).toBe(0);

      const again = await start(user, main.topicId);
      expect(again.status).toBe(200);
      expect(again.body.sessionId).not.toBe(sessionId);
    });

    it("a time-out at or above the minimum is decided normally, and the cooldown applies", async () => {
      const user = await trainee();
      const { sessionId } = await sit(user, main.topicId, () => false, irt.IRT.minQuestions);
      const open = await prisma.testSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(open.status).toBe("IN_PROGRESS"); // ten wrong answers do not reach the SE stop
      await expire(sessionId);

      as(user);
      const ended = await post(app!.finish, { sessionId, reason: "TIMED_OUT" });
      expect(ended.body.result).toMatchObject({ abandoned: false, reason: "TIMED_OUT", answered: 10 });

      const stored = await prisma.testSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(stored.status).toBe("FAILED");

      const again = await start(user, main.topicId);
      expect(again.status).toBe(429);
    });

    it("an INCONCLUSIVE result never starts the retry cooldown", async () => {
      const user = await trainee();
      const { sessionId, last } = await sit(user, easy.topicId, () => true);
      expect(last?.body.result).toMatchObject({ inconclusive: true, reason: "BANK_EXHAUSTED" });
      const stored = await prisma.testSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(stored.status).toBe("INCONCLUSIVE");

      const again = await start(user, easy.topicId);
      expect(again.status).toBe(200);
    });
  });

  // --- 8. Consistency -----------------------------------------------------

  /** The pure answer-route loop (as in engine.sim.ts) for the same script. */
  async function simulated(topicId: string, correct: (n: number) => boolean) {
    const bank = await prisma.questionItem.findMany({ where: { topicId, isActive: true } });
    const responses: { questionId: string; isCorrect: boolean }[] = [];
    let estimate = irt.estimateEap([], bank);
    for (;;) {
      const item = irt.selectNextQuestion(
        estimate.theta,
        bank,
        responses.map((r) => r.questionId)
      );
      if (!item) break;
      responses.push({ questionId: item.id, isCorrect: correct(responses.length) });
      estimate = irt.estimateEap(responses, bank);
      if (irt.shouldStop(responses.length, estimate.se)) break;
    }
    const percent = (100 * responses.filter((r) => r.isCorrect).length) / responses.length;
    return { ...estimate, percent, decision: irt.decide(estimate.theta, estimate.se, percent) };
  }

  /** What the result page and the admin CSV show for one session. */
  async function shown(user: User, sessionId: string) {
    as(user);
    const html = renderToStaticMarkup(await app!.ResultPage({ params: Promise.resolve({ sessionId }) }));
    as(admin);
    const csv = await (
      await app!.report(new Request("http://local.test"), {
        params: Promise.resolve({ userId: user.id })
      })
    ).text();
    const row = csv.trim().split("\r\n")[1].split(",");
    return { html, csvStatus: row[3], csvLevel: row[4] || null };
  }

  describe("D15.8 consistency", () => {
    const scripts: [string, "main" | "easy", (n: number) => boolean][] = [
      ["a perfect run (PASS)", "main", () => true],
      ["an all-wrong run (FAIL)", "main", () => false],
      ["a mixed run", "main", (n) => n % 3 !== 2],
      ["a perfect run on the easy bank (INCONCLUSIVE)", "easy", () => true]
    ];

    for (const [name, which, correct] of scripts) {
      it(`${name}: stored session, badge, result page and admin report agree with the simulation`, async () => {
        const topic = which === "main" ? main : easy;
        const user = await trainee();
        const { sessionId } = await sit(user, topic.topicId, correct);
        const expected = await simulated(topic.topicId, correct);

        // The stored session is the simulated decision.
        const stored = await prisma.testSession.findUniqueOrThrow({
          where: { id: sessionId },
          include: { certification: true }
        });
        expect(stored.abilityEstimate).toBeCloseTo(expected.theta, 10);
        expect(stored.standardError).toBeCloseTo(expected.se, 10);
        expect(stored.status).toBe(STATUS[expected.decision.outcome]);
        expect(stored.certified).toBe(expected.decision.outcome === "PASS");

        // The badge row is decide() on the stored values.
        const level = expected.decision.outcome === "PASS" ? expected.decision.level : null;
        if (level) {
          expect(stored.certification).toMatchObject({ badgeLevel: level, topicId: topic.topicId });
          expect(stored.certification!.abilityScore).toBeCloseTo(stored.abilityEstimate, 10);
          expect(stored.certification!.percentCorrect).toBeCloseTo(expected.percent, 10);
        } else {
          expect(stored.certification).toBeNull();
        }

        // The result page and the admin report say the same.
        const { html, csvStatus, csvLevel } = await shown(user, sessionId);
        expect(html).toContain(stored.status);
        expect(csvStatus).toBe(stored.status);
        expect(csvLevel).toBe(level ? irt.LEVEL_LABEL[level] : null);
        if (level) expect(html).toContain(`Passed at ${irt.LEVEL_LABEL[level]} level`);
      });
    }

    it("ABANDONED and TERMINATED: no badge, and the page and report agree with the stored status", async () => {
      const abandoner = await trainee();
      const left = await sit(abandoner, main.topicId, () => true, 2);
      await expire(left.sessionId);
      as(abandoner);
      await post(app!.question, { sessionId: left.sessionId });

      const cheat = await trainee();
      const caught = await sit(cheat, main.topicId, () => true, 5);
      as(cheat);
      let last;
      for (const kind of ["COPY", "PASTE", "CONTEXT_MENU", "DEVTOOLS_ATTEMPT"]) {
        last = await post(app!.integrity, { sessionId: caught.sessionId, kind });
      }
      expect(last!.body.terminated).toBe(true);

      for (const [user, sessionId, status] of [
        [abandoner, left.sessionId, "ABANDONED"],
        [cheat, caught.sessionId, "TERMINATED"]
      ] as const) {
        const stored = await prisma.testSession.findUniqueOrThrow({ where: { id: sessionId } });
        expect(stored.status).toBe(status);
        expect(await prisma.certification.count({ where: { userId: user.id } })).toBe(0);
        const { html, csvStatus, csvLevel } = await shown(user, sessionId);
        expect(html).toContain(status);
        expect(csvStatus).toBe(status);
        expect(csvLevel).toBeNull();
      }
    });

    it("an ABANDONED result page does not mention a cooldown, since none applies", async () => {
      const user = await trainee();
      const { sessionId } = await sit(user, main.topicId, () => true, 1);
      await expire(sessionId);
      as(user);
      await post(app!.question, { sessionId });
      const { html } = await shown(user, sessionId);
      expect(html).not.toMatch(/cooldown/i);
    });
  });
});
