/**
 * Sign-in (src/lib/auth.ts) on a real database: the password check, the
 * failed-login throttle (flags S3) and the per-request account re-check that
 * ends a deactivated user's session. The integration setup replaces
 * getServerSession, so these call authOptions directly.
 */
import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import type { JWT } from "next-auth/jwt";
import { authOptions } from "@/lib/auth";
import { LOGIN_LIMITS, TOO_MANY_ATTEMPTS } from "@/lib/login-limits";
import { prisma } from "@/lib/prisma";
import { createUser } from "./fixtures";

const PASSWORD = "correct horse battery";

type Authorize = (
  credentials: Record<string, string>,
  req: { headers: Record<string, string> }
) => Promise<{ id: string; role: string } | null>;
const authorize = (authOptions.providers[0] as unknown as { options: { authorize: Authorize } }).options.authorize;

async function account(data: { isActive?: boolean } = {}) {
  const user = await createUser("ADVISOR", data);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  return user;
}

const signInAs = (email: string, password: string, ip = "203.0.113.7") =>
  authorize({ email, password }, { headers: { "x-real-ip": ip } });

describe("authorize", () => {
  it("accepts the right password, whatever the email's case, and returns no hash", async () => {
    const user = await account();
    const result = await signInAs(user.email.toUpperCase(), PASSWORD);
    expect(result).toEqual({ id: user.id, email: user.email, name: user.name, role: "ADVISOR" });
  });

  it("refuses a wrong password and a deactivated account, recording each failure", async () => {
    const [user, inactive] = [await account(), await account({ isActive: false })];
    expect(await signInAs(user.email, "wrong password!")).toBeNull();
    expect(await signInAs(inactive.email, PASSWORD)).toBeNull();
    expect(await signInAs("nobody@test.local", PASSWORD)).toBeNull();
    // Hashed keys only: email and IP never stored in the clear.
    const keys = await prisma.loginFailure.findMany({ select: { key: true } });
    expect(keys.length).toBe(6);
    expect(JSON.stringify(keys)).not.toMatch(/test\.local|203\.0\.113/);
  });

  it(`blocks an email after ${LOGIN_LIMITS.perEmail} failures, even with the right password`, async () => {
    const user = await account();
    for (let i = 0; i < LOGIN_LIMITS.perEmail; i += 1) {
      expect(await signInAs(user.email, "wrong password!", `198.51.100.${i}`)).toBeNull();
    }
    await expect(signInAs(user.email, PASSWORD, "198.51.100.200")).rejects.toThrow(TOO_MANY_ATTEMPTS);
  });

  it(`blocks an address after ${LOGIN_LIMITS.perIp} failures across accounts`, async () => {
    const user = await account();
    for (let i = 0; i < LOGIN_LIMITS.perIp; i += 1) {
      await signInAs(`guess${i}@test.local`, "wrong password!", "192.0.2.9");
    }
    await expect(signInAs(user.email, PASSWORD, "192.0.2.9")).rejects.toThrow(TOO_MANY_ATTEMPTS);
    expect(await signInAs(user.email, PASSWORD, "192.0.2.10")).not.toBeNull();
  });

  it("a successful sign-in clears that email's failures", async () => {
    const user = await account();
    for (let i = 0; i < LOGIN_LIMITS.perEmail - 1; i += 1) {
      await signInAs(user.email, "wrong password!", `198.51.100.${i}`);
    }
    expect(await signInAs(user.email, PASSWORD)).not.toBeNull();
    for (let i = 0; i < LOGIN_LIMITS.perEmail - 1; i += 1) {
      await signInAs(user.email, "wrong password!", `198.51.100.${i}`);
    }
    expect(await signInAs(user.email, PASSWORD)).not.toBeNull();
  });
});

describe("the session re-check on every request", () => {
  const jwt = authOptions.callbacks!.jwt! as (params: { token: JWT }) => Promise<JWT>;

  it("ends the session of an account deactivated after sign-in", async () => {
    const user = await account();
    const token = { id: user.id, role: "ADVISOR" } as JWT;
    expect(await jwt({ token })).toMatchObject({ id: user.id });
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    await expect(jwt({ token })).rejects.toThrow("Session revoked");
  });

  it("applies a role change on the next request, and ends a deleted account's session", async () => {
    const user = await account();
    const token = { id: user.id, role: "ADVISOR" } as JWT;
    await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    expect((await jwt({ token })).role).toBe("ADMIN");
    await prisma.user.delete({ where: { id: user.id } });
    await expect(jwt({ token })).rejects.toThrow("Session revoked");
  });
});
