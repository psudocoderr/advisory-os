/**
 * Reports whether a database's actual shape matches prisma/schema.prisma.
 *
 * Run this BEFORE baselining migrations onto a database that was built with
 * `db push`. Baselining over undetected drift bakes the divergence in
 * permanently, because the recorded migration then describes a schema the
 * database does not have.
 *
 * Also used by CI to prove that prisma/migrations/ still reproduces
 * prisma/schema.prisma.
 *
 * Invoked via scripts/with-env.mjs, which has already loaded .env/.env.local.
 */
import { spawnSync } from "node:child_process";
import { classifyDatabaseTarget } from "./db-target.mjs";

// migrate diff needs a session-mode connection; the pgbouncer pooler on :6543
// cannot serve it. This is the same distinction that broke login in 43f7e37.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  console.error("No DIRECT_URL or DATABASE_URL set. Nothing to compare against.");
  process.exit(1);
}

const target = classifyDatabaseTarget(url);
console.log(`Comparing prisma/schema.prisma against the ${target.kind} database at ${target.host}...\n`);

const result = spawnSync(
  "prisma",
  ["migrate", "diff", "--from-url", url, "--to-schema-datamodel", "prisma/schema.prisma", "--script", "--exit-code"],
  { shell: true, stdio: "inherit" }
);

// prisma migrate diff: 0 = no difference, 2 = differences found, 1 = error.
if (result.status === 0) {
  console.log("\nNo drift. The database matches prisma/schema.prisma.");
  process.exit(0);
}

if (result.status === 2) {
  console.error(
    "\nDRIFT DETECTED. The SQL above is what it would take to bring this database\n" +
      "in line with prisma/schema.prisma.\n\n" +
      "Do not baseline migrations until this is resolved. Decide which side is\n" +
      "correct — the database or the schema file — and reconcile deliberately.\n" +
      "See docs/engineering/runbook.md.\n"
  );
  process.exit(2);
}

console.error("\nprisma migrate diff failed. See the output above.\n");
process.exit(result.status ?? 1);
