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
import readline from "node:readline";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Published in this repository. Never acceptable on a deployed instance. */
const PUBLISHED_DEFAULTS = ["ChangeMeAdmin123!", "ChangeMeAdvisor123!"];

/**
 * Asks a question on the terminal. With `hidden`, keystrokes are not echoed.
 *
 * Prompting matters here rather than being a convenience: an admin password
 * passed as `ADMIN_PASSWORD=... npm run ...` is written to shell history in
 * plaintext, and one left in .env.local persists on disk long after it is
 * needed. Neither is acceptable for an account that can read every client
 * record. Typed input goes to neither place.
 */
function ask(prompt: string, { hidden = false } = {}): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    if (hidden) {
      // readline echoes each keystroke through _writeToOutput. Swallow
      // everything except the prompt itself.
      const asAny = rl as unknown as { _writeToOutput: (s: string) => void };
      asAny._writeToOutput = (str: string) => {
        if (str.includes(prompt)) process.stdout.write(str);
      };
    }

    rl.question(prompt, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

/**
 * Environment variable if present, otherwise a prompt.
 *
 * Without a TTY -- CI, a pipe, a non-interactive shell -- there is nobody to
 * prompt, so it fails loudly rather than hanging forever waiting on stdin.
 */
async function obtain(variable: string, prompt: string, { hidden = false } = {}): Promise<string> {
  const fromEnv = process.env[variable];
  if (fromEnv) return fromEnv;

  if (!process.stdin.isTTY) {
    throw new Error(
      `${variable} is not set, and there is no terminal to prompt on.\n\n` +
        `  Set it in the environment for non-interactive use:\n` +
        `    ${variable}='...' npm run bootstrap:admin\n\n` +
        `  Interactively, just run 'npm run bootstrap:admin' from a terminal and\n` +
        `  it will ask. That keeps the password out of your shell history.\n`
    );
  }

  const answer = await ask(prompt, { hidden });
  if (!answer) throw new Error(`No value given for ${variable}. Nothing was changed.`);
  return answer;
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
  const email = (await obtain("ADMIN_EMAIL", "Admin email: ")).toLowerCase().trim();

  const password = await obtain("ADMIN_PASSWORD", "Password (not shown): ", { hidden: true });
  assertPasswordUsable(password);

  // Confirm only when it was typed. A typo here locks you out of the account
  // this script exists to recover, and there is no second recovery path.
  if (!process.env.ADMIN_PASSWORD) {
    const again = await ask("Confirm password: ", { hidden: true });
    if (again !== password) throw new Error("Passwords did not match. Nothing was changed.");
  }

  // Must check for a terminal before prompting. An earlier version called
  // ask() unconditionally here, so a fully-configured non-interactive run with
  // ADMIN_NAME unset waited on stdin that was never going to arrive.
  const fallbackName = email.split("@")[0];
  const name =
    process.env.ADMIN_NAME ||
    (process.stdin.isTTY ? (await ask(`Display name [${fallbackName}]: `)) || fallbackName : fallbackName);

  // Defaults to ADMIN because that is what this script is for, but must be
  // overridable. Hardcoding it meant running this on an ADVISOR account to
  // fix its password silently promoted that person to ADMIN, handing them
  // every client record including PAN. A password reset must never change
  // privilege as a side effect.
  const role = (process.env.ADMIN_ROLE || "ADMIN").toUpperCase();
  if (role !== "ADMIN" && role !== "ADVISOR") {
    throw new Error(`ADMIN_ROLE must be ADMIN or ADVISOR, not "${role}".`);
  }

  const target = process.env.DIRECT_URL || process.env.DATABASE_URL;
  const host = target ? new URL(target).hostname : "unknown";
  console.log(`Target database: ${host}`);
  console.log(`Account:         ${email}\n`);

  const existing = await prisma.user.findUnique({ where: { email } });
  const passwordHash = await bcrypt.hash(password, 12);

  if (existing) {
    if (existing.role !== role) {
      console.log(`  Note: role changes from ${existing.role} to ${role}.`);
    }
    await prisma.user.update({
      where: { email },
      data: { passwordHash, role: role as never, isActive: true }
    });
    await prisma.auditLog.create({
      data: {
        actorId: existing.id,
        action: "UPDATE",
        entity: "User",
        entityId: existing.id,
        summary: `Password reset and ${role} role set for ${email} via bootstrap-admin`
      }
    });
    console.log(`Reset the password for the existing account ${email}.`);
    console.log(`Role is ${role} and the account is active.`);
  } else {
    const created = await prisma.user.create({
      data: { email, name, passwordHash, role: role as never, isActive: true }
    });
    await prisma.auditLog.create({
      data: {
        actorId: created.id,
        action: "CREATE",
        entity: "User",
        entityId: created.id,
        summary: `${role} account ${email} created via bootstrap-admin`
      }
    });
    console.log(`Created a new ${role} account for ${email}.`);
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
