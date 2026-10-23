/**
 * Changing your own password (changePassword in src/lib/actions.ts) on a real
 * database: the current password is required, wrong guesses share the
 * sign-in throttle, and the new one meets the same rule as everywhere else.
 * An account created in Admin › Users must do this before anything else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import * as actions from "@/lib/actions";
import { POST as start } from "@/app/api/certify/start/route";
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
  actions.changePassword(NONE, form({ current: CURRENT, password: NEXT, confirm: NEXT, ...fields }));
const hash = async () => (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash;

describe("changePassword", () => {
  it("replaces the password, records it, and sends the user to sign in again", async () => {
    expect(await redirectedTo(change({}))).toBe("/login?changed=1");
    expect(await bcrypt.compare(NEXT, await hash())).toBe(true);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordChangedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
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

describe("an account on an admin-set password", () => {
  const pending = () => signIn({ ...user, mustChangePassword: true } as TestUser);

  it("is created that way by the admin form", async () => {
    signIn(await createUser("ADMIN"));
    const fields = {
      name: "New Hire",
      email: "new.hire@test.local",
      password: "a temporary password",
      role: "ADVISOR"
    };
    expect(await actions.createUser(NONE, form(fields))).toEqual({ ok: expect.any(Number) });
    const row = await prisma.user.findUniqueOrThrow({ where: { email: "new.hire@test.local" } });
    expect(row.passwordChangedAt).toBeNull();
  });

  it("is sent to /change-password by every other action", async () => {
    pending();
    expect(await redirectedTo(actions.createProspect(NONE, form({})))).toBe("/change-password");
    expect(await redirectedTo(actions.markChapterComplete(NONE, form({ chapterId: "x" })))).toBe("/change-password");
  });

  it("gets 401 from the API routes", async () => {
    pending();
    const response = await start(
      new Request("http://test.local/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topicId: "x" })
      })
    );
    expect(response.status).toBe(401);
  });

  it("may change its password, which clears the flag", async () => {
    await prisma.user.update({ where: { id: user.id }, data: { passwordChangedAt: null } });
    pending();
    expect(await redirectedTo(change({}))).toBe("/login?changed=1");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordChangedAt).not.toBeNull();
  });
});
