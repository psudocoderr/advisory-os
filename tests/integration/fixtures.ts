/**
 * Small factories for integration tests. Not the seed: that has volume guards
 * and fixed data. Each test builds only what it needs on empty tables.
 */
import type { Role } from "@prisma/client";
import type { Session } from "next-auth";
import { IRT } from "@/lib/irt";
import { prisma } from "@/lib/prisma";
import { auth } from "./session";

export type TestUser = { id: string; role: Role; name: string; email: string };

let counter = 0;

export async function createUser(role: Role = "ADVISOR", data: { isActive?: boolean } = {}): Promise<TestUser> {
  counter += 1;
  const row = await prisma.user.create({
    data: { email: `user${counter}@test.local`, name: `User ${counter}`, passwordHash: "x", role, ...data }
  });
  return { id: row.id, role: row.role, name: row.name, email: row.email };
}

/** Every route after this sees `user` as signed in; `null` signs out. */
export function signIn(user: TestUser | null) {
  auth.session = user ? ({ user, expires: new Date(Date.now() + 3600_000).toISOString() } as Session) : null;
}

const KEYS = ["A", "B", "C", "D"] as const;

/**
 * A published track > module > topic > chapter with `size` questions, their
 * difficulties spread evenly over [from, to] and the correct key rotated.
 */
export async function createTopic(options: { size?: number; from?: number; to?: number; order?: number } = {}) {
  const { size = 40, from = -2.5, to = 2.5 } = options;
  counter += 1;
  const order = options.order ?? counter;
  const author = await createUser("ADMIN");
  const track = await prisma.track.create({ data: { slug: `track-${counter}`, title: `Track ${counter}`, order } });
  const mod = await prisma.module.create({ data: { trackId: track.id, slug: "module", title: "Module", order: 1 } });
  const topic = await prisma.topic.create({
    data: { moduleId: mod.id, slug: "topic", title: `Topic ${counter}`, order: 0 }
  });
  const chapter = await prisma.chapter.create({
    data: { topicId: topic.id, slug: "chapter", title: "Chapter", order: 1, isPublished: true }
  });
  await prisma.questionItem.createMany({
    data: Array.from({ length: size }, (_, i) => ({
      topicId: topic.id,
      chapterId: chapter.id,
      content: `Question ${i}?`,
      options: KEYS.map((key) => ({ key, text: `${key}${i}` })),
      correctKey: KEYS[i % 4],
      explanation: "Because.",
      difficulty: size === 1 ? from : from + ((to - from) * i) / (size - 1),
      createdById: author.id
    }))
  });
  return { trackId: track.id, topicId: topic.id, chapterId: chapter.id };
}

/** Marks every chapter of the topic read, which unlocks its test. */
export async function completeChapters(user: TestUser, topic: { chapterId: string }) {
  await prisma.chapterCompletion.create({ data: { userId: user.id, chapterId: topic.chapterId } });
}

/** Calls a route handler as the browser would, with a JSON body. */
export async function post(handler: (request: Request) => Promise<Response>, body: unknown) {
  const response = await handler(
    new Request("http://test.local/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
  return { status: response.status, body: await response.json() };
}

/** What the time limit passing looks like to the server. */
export function expire(sessionId: string) {
  return prisma.testSession.update({
    where: { id: sessionId },
    data: { timerStartedAt: new Date(Date.now() - (IRT.timeLimitMinutes + 1) * 60_000) }
  });
}

/** A wrong key for a question. */
export function wrongKey(correctKey: string) {
  return KEYS.find((key) => key !== correctKey)!;
}

/** A FormData from plain fields, as a form post sends them. */
export function form(fields: Record<string, string | number>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, String(value));
  return data;
}

/**
 * Where a call redirected to (`redirect()` throws), or null when it returned
 * normally. Any other error is rethrown.
 */
export async function redirectedTo(call: Promise<unknown>): Promise<string | null> {
  try {
    await call;
    return null;
  } catch (error) {
    const digest = (error as { digest?: string }).digest;
    if (!digest?.startsWith("NEXT_REDIRECT;")) throw error;
    return digest.split(";")[2];
  }
}

let serial = 0;
/** A unique valid Indian mobile number and PAN for each call. */
export function identifiers() {
  serial += 1;
  const n = String(serial).padStart(4, "0");
  return { phone: `98765${n.padStart(5, "0")}`, pan: `ABCDE${n}F` };
}

export async function createProspectFor(owner: TestUser) {
  return prisma.prospect.create({
    data: {
      name: "Prospect",
      phone: `+91${identifiers().phone}`,
      source: "REFERRAL",
      firstContactDate: new Date(),
      notes: "",
      assignedToId: owner.id
    }
  });
}

export async function createClientFor(owner: TestUser) {
  const { phone, pan } = identifiers();
  return prisma.client.create({
    data: {
      name: "Client",
      phone: `+91${phone}`,
      pan,
      aum: 100000,
      onboardingDate: new Date(),
      assignedToId: owner.id
    }
  });
}
