/**
 * Captures the current database contents to backups/ before they are lost.
 *
 * prisma/seed.ts begins with clear(), which deletes every row. Anything
 * created while testing -- CRM records, certification attempts, audit trail --
 * disappears with it, and there was no way to look at what was there
 * afterwards. This writes a snapshot so a reseed is reviewable rather than
 * simply destructive.
 *
 * Two files per run, in backups/ (gitignored):
 *   pre-seed-<timestamp>.json  complete rows, machine-readable
 *   pre-seed-<timestamp>.md    a summary to read
 *
 * DEV ONLY, and enforced, not merely documented. Against a deployed database
 * this writes counts alone and no row contents: a full dump would put client
 * PAN, phone numbers and AUM into a plaintext file on a laptop, which is the
 * kind of copy that outlives the reason it was made. Use a real database
 * backup for deployed environments instead.
 *
 *   npm run db:snapshot
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { classifyDatabaseTarget, isEphemeral, type Target } from "./db-target.mjs";

const prisma = new PrismaClient();

async function main() {
  const target: Target = classifyDatabaseTarget(process.env.DIRECT_URL || process.env.DATABASE_URL);
  const full = isEphemeral(target);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  mkdirSync("backups", { recursive: true });

  const counts = {
    users: await prisma.user.count(),
    prospects: await prisma.prospect.count(),
    clients: await prisma.client.count(),
    meetingLogs: await prisma.meetingLog.count(),
    investmentPlans: await prisma.investmentPlan.count(),
    portfolioReviews: await prisma.portfolioReview.count(),
    knowledgeCategories: await prisma.knowledgeCategory.count(),
    sopEntries: await prisma.sopEntry.count(),
    questionItems: await prisma.questionItem.count(),
    testSessions: await prisma.testSession.count(),
    responseLogs: await prisma.responseLog.count(),
    certifications: await prisma.certification.count(),
    integrityEvents: await prisma.integrityEvent.count(),
    auditLogs: await prisma.auditLog.count()
  };

  // Always safe to summarise: outcomes, not personal data.
  const sessions = await prisma.testSession.findMany({
    orderBy: { startedAt: "desc" },
    select: {
      module: true,
      status: true,
      attemptNumber: true,
      abilityEstimate: true,
      standardError: true,
      certified: true,
      startedAt: true,
      completedAt: true,
      user: { select: { email: true } },
      _count: { select: { responses: true, integrityEvents: true } }
    }
  });

  const certifications = await prisma.certification.findMany({
    select: { module: true, level: true, status: true, abilityScore: true, issuedAt: true, expiresAt: true }
  });

  const snapshot: Record<string, unknown> = {
    capturedAt: new Date().toISOString(),
    database: { kind: target.kind, host: target.host },
    redacted: !full,
    counts,
    testSessions: sessions,
    certifications
  };

  if (full) {
    // Ephemeral database: fixtures only, safe to keep verbatim.
    Object.assign(snapshot, {
      users: await prisma.user.findMany({ select: { email: true, name: true, role: true, isActive: true } }),
      prospects: await prisma.prospect.findMany(),
      clients: await prisma.client.findMany(),
      meetingLogs: await prisma.meetingLog.findMany(),
      investmentPlans: await prisma.investmentPlan.findMany(),
      portfolioReviews: await prisma.portfolioReview.findMany(),
      auditLogs: await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 })
    });
  }

  const jsonPath = `backups/pre-seed-${stamp}.json`;
  writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2));

  const lines: string[] = [
    `# Database snapshot — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    "",
    `Target: **${target.kind}** (\`${target.host}\`)`,
    full
      ? "Contents captured in full — ephemeral database."
      : "**Row contents omitted.** Deployed database: counts and test outcomes only, so that no client PAN, phone number or AUM figure is written to disk. Use a database backup for a real restore point.",
    "",
    "## Row counts",
    "",
    "| table | rows |",
    "|---|---|",
    ...Object.entries(counts).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Certification attempts",
    ""
  ];

  if (sessions.length) {
    lines.push(
      "| module | who | status | attempt | answered | theta | SE | integrity | started | completed |",
      "|---|---|---|---|---|---|---|---|---|---|",
      ...sessions.map(
        (s) =>
          `| ${s.module} | ${s.user.email} | ${s.status} | ${s.attemptNumber} | ${s._count.responses} | ` +
          `${s.abilityEstimate.toFixed(2)} | ${s.standardError === 99 ? "—" : s.standardError.toFixed(2)} | ` +
          `${s._count.integrityEvents} | ${s.startedAt.toISOString().slice(0, 16)} | ` +
          `${s.completedAt ? s.completedAt.toISOString().slice(0, 16) : "—"} |`
      )
    );
  } else {
    lines.push("_none_");
  }

  lines.push("", "## Certifications held", "");
  if (certifications.length) {
    lines.push(
      "| module | level | status | score | issued | expires |",
      "|---|---|---|---|---|---|",
      ...certifications.map(
        (c) =>
          `| ${c.module} | ${c.level} | ${c.status} | ${c.abilityScore.toFixed(2)} | ` +
          `${c.issuedAt.toISOString().slice(0, 10)} | ${c.expiresAt.toISOString().slice(0, 10)} |`
      )
    );
  } else {
    lines.push("_none_");
  }

  const mdPath = `backups/pre-seed-${stamp}.md`;
  writeFileSync(mdPath, lines.join("\n") + "\n");

  console.log(`  ${jsonPath}`);
  console.log(`  ${mdPath}`);
  console.log(`\n  ${full ? "Full contents captured." : "Counts and outcomes only (deployed database)."}`);
  console.log(`  backups/ is gitignored, so these stay on this machine.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
    await prisma.$disconnect();
    process.exit(1);
  });
