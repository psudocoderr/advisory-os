/**
 * Wrapper for `prisma db push`. Runs it only against a local database.
 *
 * Invoked via scripts/with-env.mjs, which has already loaded .env/.env.local
 * into this process's environment.
 */
import { spawnSync } from "node:child_process";
import { assertPushAllowed } from "./db-target.mjs";

try {
  assertPushAllowed(process.env.DIRECT_URL || process.env.DATABASE_URL);
} catch (error) {
  console.error(`\n${error.message}\n`);
  process.exit(1);
}

const result = spawnSync("prisma", ["db", "push", ...process.argv.slice(2)], {
  shell: true,
  stdio: "inherit"
});

process.exit(result.status ?? 1);
