/**
 * Runs before every integration test file.
 *
 * 1. Refuses any database that is not disposable: the host must be local or a
 *    CI service container (scripts/db-target.mjs), and the database name must
 *    end in `_test`, so a local run can never empty the dev database.
 * 2. Replaces the sign-in: `getServerSession` returns whoever `signIn()` set
 *    (fixtures.ts). Everything else is the real code.
 * 3. Empties every table before each test.
 */
import { afterAll, beforeEach, vi } from "vitest";
import { classifyDatabaseTarget, isEphemeral } from "../../scripts/db-target.mjs";
import { auth } from "./session";

const url = process.env.DATABASE_URL;
const target = classifyDatabaseTarget(url);
const name = url ? new URL(url).pathname.slice(1) : "";
if (!isEphemeral(target) || !name.endsWith("_test")) {
  throw new Error(
    `Integration tests refuse ${target.host ?? "no host"}/${name || "no database"}: ` +
      `they empty every table, so the host must be local or CI and the database name must end in _test.`
  );
}

vi.mock("next-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth")>()),
  getServerSession: vi.fn(async () => auth.session)
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// After the guard, so a refused run never connects.
const { prisma } = await import("@/lib/prisma");

const tables = (
  await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
).map((row) => `"${row.tablename}"`);

beforeEach(async () => {
  auth.session = null;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.join(", ")} CASCADE`);
});

afterAll(() => prisma.$disconnect());
