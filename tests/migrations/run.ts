/**
 * Migrations against old-shaped data (flags O9).
 *
 * CI's migrations job applies every migration to an empty database, so a
 * migration that converts existing rows is never exercised there. Each case
 * here is a folder named after one migration:
 *
 *   tests/migrations/<migration>/before.sql  rows as they looked just before it
 *   tests/migrations/<migration>/after.sql   checks once every migration has run
 *
 * For each case the database is emptied, migrated to just before that
 * migration, loaded with before.sql, then migrated all the way with
 * `prisma migrate deploy`, the same command production runs. Every statement
 * in after.sql is a SELECT returning one row whose `ok` column must be true;
 * an optional `detail` column is printed when it is not.
 *
 * Needs a disposable database (local or CI host, name ending in _test); it is
 * wiped for every case. Run: npm run test:migrations
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { classifyDatabaseTarget, isEphemeral } from "../../scripts/db-target.mjs";

const MIGRATIONS = "prisma/migrations";
const CASES = "tests/migrations";

/**
 * Statements in a SQL file, split on a semicolon that ends a line. Comments
 * stay in (a check's leading comment is its label); a chunk that is only
 * comments is skipped.
 */
function statements(file: string) {
  return readFileSync(file, "utf8")
    .split(/;\s*$/m)
    .map((sql) => sql.trim())
    .filter((sql) => sql.replace(/^\s*--.*$/gm, "").trim());
}

/** `prisma migrate deploy` with only the migrations before `stop` (all of them when undefined). */
function deploy(stop?: string) {
  let schema = "prisma/schema.prisma";
  let dir: string | undefined;
  if (stop) {
    // Prisma reads the migrations folder next to the schema file.
    dir = mkdtempSync(join(tmpdir(), "migrations-"));
    cpSync(schema, join(dir, "schema.prisma"));
    for (const name of readdirSync(MIGRATIONS).filter((name) => name < stop)) {
      cpSync(join(MIGRATIONS, name), join(dir, "migrations", name), { recursive: true });
    }
    schema = join(dir, "schema.prisma");
  }
  try {
    execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", schema], { stdio: "pipe" });
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  const name = url ? new URL(url).pathname.slice(1) : "";
  if (!isEphemeral(classifyDatabaseTarget(url)) || !name.endsWith("_test")) {
    throw new Error(
      `refusing ${name || "no database"}: every case empties it, so it must be local/CI and end in _test`
    );
  }
  const migrations = new Set(readdirSync(MIGRATIONS));
  const cases = readdirSync(CASES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const db = new PrismaClient();
  let failures = 0;

  for (const migration of cases) {
    if (!migrations.has(migration)) throw new Error(`${CASES}/${migration}: no migration of that name`);
    await db.$executeRawUnsafe("DROP SCHEMA public CASCADE");
    await db.$executeRawUnsafe("CREATE SCHEMA public");
    deploy(migration);
    try {
      for (const sql of statements(join(CASES, migration, "before.sql"))) await db.$executeRawUnsafe(sql);
    } catch (error) {
      failures += 1;
      console.log(`FAIL ${migration}: before.sql did not load: ${(error as Error).message.split("\n").pop()}`);
      continue;
    }
    try {
      deploy();
    } catch (error) {
      failures += 1;
      const output =
        String((error as { stdout?: Buffer }).stdout ?? "") + String((error as { stderr?: Buffer }).stderr ?? "");
      console.log(
        `FAIL ${migration}: migrate deploy failed on the old rows\n${output.trim().split("\n").slice(-8).join("\n")}`
      );
      continue;
    }
    for (const sql of statements(join(CASES, migration, "after.sql"))) {
      const label = sql.match(/^--\s*(.*)$/m)?.[1] ?? sql.replace(/\s+/g, " ").slice(0, 90);
      let row: { ok: boolean; detail?: unknown } | undefined;
      try {
        [row] = await db.$queryRawUnsafe<{ ok: boolean; detail?: unknown }[]>(sql);
      } catch (error) {
        row = { ok: false, detail: (error as Error).message.split("\n").find((line) => line.includes("ERROR")) };
      }
      if (row?.ok === true) {
        console.log(`PASS ${migration}: ${label}`);
      } else {
        failures += 1;
        console.log(
          `FAIL ${migration}: ${label}${row?.detail === undefined ? "" : ` (${JSON.stringify(row.detail)})`}`
        );
      }
    }
  }

  await db.$disconnect();
  console.log(`\n${cases.length} migration case(s), ${failures} failure(s)`);
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
