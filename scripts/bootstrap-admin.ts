/**
 * Creates or resets a single admin account, without destroying anything.
 *
 * This exists because there is no other way to do it. Passwords are written in
 * exactly two places -- createUser() and the seed -- both at creation time.
 * The application has no password reset, no email provider, and no way to
 * change an existing user's password through the UI. So a deployed instance
 * whose admin password is unknown, or which has no admin at all, has no
 * recovery path without this script.
 *
 * It is the deliberate opposite of prisma/seed.ts:
 *
 *   seed.ts              this script
 *   -------              -----------
 *   deletes every row    touches exactly one row
 *   refuses deployed DBs runs against deployed DBs on purpose
 *   creates fixtures     creates no fixtures
 *
 * Usage (from a machine with the production connection string):
 *
 *   ADMIN_EMAIL=you@example.com \
 *   ADMIN_PASSWORD='<a real password>' \
 *   ADMIN_NAME='Your Name' \
 *   npm run bootstrap:admin
 *
 * After resetting a password, rotate NEXTAUTH_SECRET as well. Sessions are
 * 8-hour JWTs and isActive/role are only read at login, so a password change
 * alone does not end sessions already issued. See docs/flags.md S1/S2.
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Published in this repository. Never acceptable on a deployed instance. */
const PUBLISHED_DEFAULTS = ["ChangeMeAdmin123!", "ChangeMeAdvisor123!"];

function required(variable: string): string {
  const value = process.env[variable];
  if (!value) {
    throw new Error(
      `${variable} is not set.\n\n` +
        `  Usage:\n` +
        `    ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' ADMIN_NAME='Your Name' \\\n` +
        `      npm run bootstrap:admin\n`
    );
  }
  return value;
}

function assertPasswordUsable(password: string): void {
  if (PUBLISHED_DEFAULTS.includes(password)) {
    throw new Error(
      "That password is published in this repository (.env.example and git history).\n" +
        "  Setting it on a deployed instance would hand out the credential.\n" +
        "  Choose a different one."
    );
  }

  if (password.length < 12) {
    throw new Error(
      `Password is ${password.length} characters. Use at least 12.\n\n` +
        `  This account has ADMIN role, which bypasses row scoping entirely\n` +
        `  (src/lib/auth.ts scopedUserFilter) and can read every client record\n` +
        `  including PAN and AUM. There is also no login rate limiting yet\n` +
        `  (docs/flags.md S3), so nothing slows an attacker down.`
    );
  }
}

async function main() {
  // All validation before any write, and before any database round-trip.
  const email = required("ADMIN_EMAIL").toLowerCase().trim();
  const password = required("ADMIN_PASSWORD");
  const name = process.env.ADMIN_NAME || email.split("@")[0];
  assertPasswordUsable(password);

  const target = process.env.DIRECT_URL || process.env.DATABASE_URL;
  const host = target ? new URL(target).hostname : "unknown";
  console.log(`Target database: ${host}`);
  console.log(`Account:         ${email}\n`);

  const existing = await prisma.user.findUnique({ where: { email } });
  const passwordHash = await bcrypt.hash(password, 12);

  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { passwordHash, role: "ADMIN", isActive: true }
    });
    await prisma.auditLog.create({
      data: {
        actorId: existing.id,
        action: "UPDATE",
        entity: "User",
        entityId: existing.id,
        summary: `Password reset and ADMIN role confirmed for ${email} via bootstrap-admin`
      }
    });
    console.log(`Reset the password for the existing account ${email}.`);
    console.log(`Role set to ADMIN and the account re-activated.`);
  } else {
    const created = await prisma.user.create({
      data: { email, name, passwordHash, role: "ADMIN", isActive: true }
    });
    await prisma.auditLog.create({
      data: {
        actorId: created.id,
        action: "CREATE",
        entity: "User",
        entityId: created.id,
        summary: `Admin account ${email} created via bootstrap-admin`
      }
    });
    console.log(`Created a new ADMIN account for ${email}.`);
  }

  const total = await prisma.user.count();
  console.log(`\nUsers on this database: ${total}`);
  console.log(
    `\nSessions already issued are NOT invalidated by this change.\n` +
      `Rotate NEXTAUTH_SECRET to end them all at once. See docs/flags.md S1/S2.`
  );
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(`\n${error instanceof Error ? error.message : error}\n`);
    await prisma.$disconnect();
    process.exit(1);
  });
