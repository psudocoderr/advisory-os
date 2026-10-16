import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { LOGIN_LIMITS } from "@/lib/login-limits";

/**
 * Failed-login throttling (flags S3).
 *
 * Counted in Postgres rather than in memory: each Vercel instance has its own
 * memory, so an in-process counter is reset by every cold start and never
 * shared, which makes it a speed bump rather than a limit.
 *
 * Two limits, because each stops what the other cannot:
 *   per email  guessing one account's password, even spread over many IPs.
 *   per IP     one source trying many accounts. Generous, because an office
 *              shares one address.
 *
 * Checked before bcrypt, so a throttled request costs no hashing. Only
 * failures are recorded; a successful sign-in clears its email's count.
 * Keys are hashed and rows deleted after a day, so the table is not a log of
 * who tried to sign in from where.
 *
 * ponytail: count-then-insert, so a burst of parallel requests can overshoot
 * a limit by the number in flight. Bounded and harmless here; a single
 * upsert-and-return counter would close it.
 */
const RETENTION_MS = 24 * 60 * 60 * 1000;

export function throttleKeys(email: string, ip: string | null) {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  return { email: hash(`email:${email}`), ip: ip ? hash(`ip:${ip}`) : null };
}

/** Whether these recent failure counts block another attempt. */
export function isThrottled(failures: { email: number; ip: number }): boolean {
  return failures.email >= LOGIN_LIMITS.perEmail || failures.ip >= LOGIN_LIMITS.perIp;
}

/**
 * The client address as Vercel reports it. Vercel sets x-real-ip and
 * overwrites x-forwarded-for with the connecting address, so neither can be
 * chosen by the client there. Elsewhere (local dev) there may be none.
 */
export function clientIp(headers: Record<string, string | string[] | undefined> | undefined): string | null {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const ip = first(headers?.["x-real-ip"]) ?? first(headers?.["x-forwarded-for"])?.split(",")[0];
  return ip?.trim() || null;
}

export async function loginBlocked(keys: ReturnType<typeof throttleKeys>): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_LIMITS.windowMinutes * 60 * 1000);
  const [email, ip] = await Promise.all([
    prisma.loginFailure.count({ where: { key: keys.email, createdAt: { gte: since } } }),
    keys.ip ? prisma.loginFailure.count({ where: { key: keys.ip, createdAt: { gte: since } } }) : 0
  ]);
  return isThrottled({ email, ip });
}

export async function recordLoginFailure(keys: ReturnType<typeof throttleKeys>): Promise<void> {
  await prisma.loginFailure.createMany({ data: [keys.email, keys.ip].flatMap((key) => (key ? [{ key }] : [])) });
  await prisma.loginFailure.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } } });
}

export async function clearLoginFailures(keys: ReturnType<typeof throttleKeys>): Promise<void> {
  await prisma.loginFailure.deleteMany({ where: { key: keys.email } });
}
