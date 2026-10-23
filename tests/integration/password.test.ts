/**
 * Changing your own password (changePassword in src/lib/actions.ts) on a real
 * database: the current password is required, wrong guesses share the
 * sign-in throttle, and the new one meets the same rule as everywhere else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { changePassword } from "@/lib/actions";
import { LOGIN_LIMITS } from "@/lib/login-limits";
import { prisma } from "@/lib/prisma";
import { createUser, form, redirectedTo, signIn, type TestUser } from "./fixtures";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "203.0.113.9" }) }));

const CURRENT = "the current password";
const NEXT = "a brand new password";
const NONE = {};

let user: TestUser;

beforeEach(async () => {
  user = await createUser();
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(CURRENT, 4) } });
  signIn(user);
});

const change = (fields: Record<string, string>) =>
  changePassword(NONE, form({ current: CURRENT, password: NEXT, confirm: NEXT, ...fields }));
const hash = async () => (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash;

describe("changePassword", () => {
  it("replaces the password and records it in the audit log", async () => {
    expect(await change({})).toEqual({ ok: expect.any(Number) });
    expect(await bcrypt.compare(NEXT, await hash())).toBe(true);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: user.id } });
    expect(audit.summary).toMatch(/changed their password/);
    expect(JSON.stringify(audit)).not.toContain(NEXT);
  });

  it("refuses a wrong current password and counts it toward the sign-in throttle", async () => {
    const before = await hash();
    expect(await change({ current: "not my password" })).toEqual({ error: "Your current password is not right." });
    expect(await hash()).toBe(before);
    expect(await prisma.loginFailure.count()).toBe(2); // the email key and the IP key
  });

  it.each([
    [{ password: "short", confirm: "short" }, /at least 12/],
    [{ confirm: "something else entirely" }, /do not match/],
    [{ password: CURRENT, confirm: CURRENT }, /different from the current/],
    [{ password: "ChangeMeAdmin123!", confirm: "ChangeMeAdmin123!" }, /published/]
  ])("refuses an unfit new password %#", async (fields, message) => {
    const before = await hash();
    const result = await change(fields);
    expect(result.error).toMatch(message);
    expect(await hash()).toBe(before);
  });

  it(`stops after ${LOGIN_LIMITS.perEmail} wrong guesses, even with the right password`, async () => {
    for (let i = 0; i < LOGIN_LIMITS.perEmail; i += 1) await change({ current: "a wrong guess" });
    expect((await change({})).error).toMatch(/Too many wrong passwords/);
    expect(await bcrypt.compare(CURRENT, await hash())).toBe(true);
  });

  it("sends a signed-out caller to sign in", async () => {
    signIn(null);
    expect(await redirectedTo(change({}))).toBe("/login");
  });
});
