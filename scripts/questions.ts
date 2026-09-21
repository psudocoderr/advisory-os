/**
 * Question bank tooling: audit what is there, import more from a spreadsheet.
 *
 * The bank is the company's content. This does not write questions; it gives
 * the practice a way to author them in Excel or Sheets, checks them, and loads
 * them. Growing the bank is the point -- at 12 per module the adaptive test
 * cannot converge and the retry cooldown is meaningless.
 *
 *   npm run questions:check              audit the bank in the database
 *   npm run questions:template           write a CSV template to author into
 *   npm run questions:import <file>      validate a CSV (dry run)
 *   npm run questions:import <file> --apply    validate and load it
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  MODULES,
  TARGET_BANK_SIZE,
  validateBank,
  validateQuestion,
  type Issue,
  type QuestionDraft
} from "../src/lib/question-bank";

const prisma = new PrismaClient();

const COLUMNS = [
  "module",
  "sop_slug",
  "content",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "correct_key",
  "explanation",
  "difficulty",
  "discrimination",
  "guessing"
] as const;

/** Minimal RFC4180 parser: quoted fields, embedded commas, doubled quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim()));
}

function report(issues: Issue[]): { errors: number; warnings: number } {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  for (const i of errors) console.log(`  ERROR    ${i.where}: ${i.message}`);
  for (const i of warnings) console.log(`  warning  ${i.where}: ${i.message}`);
  if (!issues.length) console.log("  no issues");
  return { errors: errors.length, warnings: warnings.length };
}

async function loadFromDatabase(): Promise<QuestionDraft[]> {
  const rows = await prisma.questionItem.findMany({
    where: { isActive: true },
    include: { linkedSop: { select: { slug: true } } }
  });
  return rows.map((r) => ({
    module: r.module,
    sopSlug: r.linkedSop.slug,
    content: r.content,
    options: r.options as { key: string; text: string }[],
    correctKey: r.correctKey,
    explanation: r.explanation,
    difficulty: r.difficulty,
    discrimination: r.discrimination,
    guessing: r.guessing
  }));
}

async function check() {
  const bank = await loadFromDatabase();
  console.log(`  ${bank.length} active questions\n`);
  for (const m of MODULES) {
    const n = bank.filter((q) => q.module === m).length;
    const bar = "#".repeat(Math.round((n / TARGET_BANK_SIZE) * 20)).padEnd(20, ".");
    console.log(`  ${m}  ${bar}  ${n}/${TARGET_BANK_SIZE}`);
  }
  console.log("");
  const { errors } = report(validateBank(bank, "database"));
  process.exitCode = errors ? 1 : 0;
}

function template() {
  const example = [
    "M1",
    "day-1-kyc-identity-baseline",
    "Which record is treated as the first source of truth for PAN-linked identity?",
    "The IT portal PAN-linked name",
    "The name on the latest bank statement",
    "The name the client gives verbally",
    "The name printed on the SIP mandate",
    "A",
    "The PAN-linked name on the income tax portal is authoritative; every other record is reconciled to it.",
    "-0.5",
    "1.1",
    "0.25"
  ];
  const csv = [COLUMNS.join(","), example.map((c) => (c.includes(",") ? `"${c}"` : c)).join(",")].join("\n") + "\n";
  writeFileSync("questions-template.csv", csv);
  console.log("  wrote questions-template.csv");
  console.log(`\n  Open it in Excel or Sheets, add one row per question, then:`);
  console.log(`    npm run questions:import questions-template.csv`);
  console.log(`\n  Guidance:`);
  console.log(`    - correct_key must vary. Roughly a quarter each of A, B, C, D.`);
  console.log(`      A bank where one key dominates is passable without reading the questions.`);
  console.log(`    - Distractors must be specific to the question. Reused filler is recognisable.`);
  console.log(`    - difficulty -2 (easy) to +2 (hard); spread them out so the adaptive test has range.`);
  console.log(`    - discrimination around 1.0; guessing 0.25 for a four-option item.`);
  console.log(`    - sop_slug must match an existing SOP. Run 'npm run questions:check' to see the bank.`);
}

async function importFile(path: string, apply: boolean) {
  const rows = parseCsv(readFileSync(path, "utf8"));
  if (!rows.length) throw new Error("file is empty");

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`missing columns: ${missing.join(", ")}`);
  const at = (row: string[], col: string) => (row[header.indexOf(col)] ?? "").trim();

  const drafts: QuestionDraft[] = rows.slice(1).map((row) => ({
    module: at(row, "module").toUpperCase(),
    sopSlug: at(row, "sop_slug"),
    content: at(row, "content"),
    options: [
      { key: "A", text: at(row, "option_a") },
      { key: "B", text: at(row, "option_b") },
      { key: "C", text: at(row, "option_c") },
      { key: "D", text: at(row, "option_d") }
    ],
    correctKey: at(row, "correct_key").toUpperCase(),
    explanation: at(row, "explanation"),
    difficulty: Number(at(row, "difficulty")),
    discrimination: Number(at(row, "discrimination")),
    guessing: Number(at(row, "guessing"))
  }));

  console.log(`  ${drafts.length} rows read from ${path}\n`);

  const issues: Issue[] = drafts.flatMap((d, i) => validateQuestion(d, `row ${i + 2}`));

  // Validate the merged bank, not just the file: a file that looks balanced on
  // its own can still tip the module it joins.
  const existing = await loadFromDatabase();
  issues.push(...validateBank([...existing, ...drafts], "resulting bank"));

  const { errors } = report(issues);
  if (errors) {
    console.log(`\n  ${errors} error(s). Nothing imported.`);
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log(`\n  Dry run. Re-run with --apply to import.`);
    return;
  }

  const sops = await prisma.sopEntry.findMany({ select: { id: true, slug: true } });
  const slugToId = new Map(sops.map((s) => [s.slug, s.id]));
  const unknown = [...new Set(drafts.map((d) => d.sopSlug))].filter((s) => !slugToId.has(s));
  if (unknown.length) {
    console.log(`\n  ERROR  unknown sop_slug: ${unknown.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const author = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!author) throw new Error("no ADMIN user to attribute these questions to");

  await prisma.questionItem.createMany({
    data: drafts.map((d) => ({
      module: d.module as never,
      content: d.content,
      options: d.options,
      correctKey: d.correctKey,
      explanation: d.explanation,
      difficulty: d.difficulty,
      discrimination: d.discrimination,
      guessing: d.guessing,
      linkedSopId: slugToId.get(d.sopSlug)!,
      createdById: author.id,
      isActive: true
    }))
  });
  await prisma.auditLog.create({
    data: {
      actorId: author.id,
      action: "CREATE",
      entity: "QuestionItem",
      summary: `Imported ${drafts.length} questions from ${path}`
    }
  });
  console.log(`\n  imported ${drafts.length} questions`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "check") return check();
  if (command === "template") return template();
  if (command === "import") {
    const file = rest.find((a) => !a.startsWith("--"));
    if (!file) throw new Error("usage: questions import <file.csv> [--apply]");
    return importFile(file, rest.includes("--apply"));
  }
  throw new Error("usage: questions <check|template|import>");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(`\n  ${e instanceof Error ? e.message : e}\n`);
    await prisma.$disconnect();
    process.exit(1);
  });
