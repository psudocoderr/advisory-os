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
 *   npm run questions:import <file> --replace --apply
 *       retire the existing questions in every module the file covers, then
 *       load it. Needed to get out from under a bank that is already broken:
 *       otherwise good questions cannot be imported, because validation is
 *       against the merged result and the existing rows keep failing it.
 *       Retiring sets isActive false rather than deleting, so past attempts
 *       keep their questions.
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
    module: r.module!,
    sopSlug: r.linkedSop!.slug,
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
  /**
   * Five worked examples rather than one. They demonstrate the things the
   * validator enforces, which are easier to copy than to read about: the
   * correct answer moves across A, B, C and D; every distractor is specific to
   * its question; difficulty is spread rather than clustered.
   */
  const examples: string[][] = [
    [
      "M1",
      "day-3-4-pan-kra-ckyc-verification",
      "The KRA record shows a different surname from the PAN-linked name. What is the correct next step?",
      "Proceed with onboarding and note the difference",
      "Raise the proof protocol and resolve before onboarding",
      "Use the KRA name for all future records",
      "Ask the client to confirm verbally and continue",
      "B",
      "A name divergence must be reconciled against the PAN-linked record before onboarding; verbal confirmation is not evidence.",
      "-0.4",
      "1.2",
      "0.25"
    ],
    [
      "M1",
      "day-1-2-nism-euin-registration",
      "Which identifier must be tagged on a transaction to attribute advice to the individual who gave it?",
      "The ARN of the distributor firm",
      "The folio number",
      "The EUIN of the individual",
      "The PAN of the investor",
      "C",
      "ARN identifies the distributor; EUIN identifies the individual employee whose advice the transaction reflects.",
      "-1.2",
      "1.0",
      "0.25"
    ],
    [
      "M2",
      "day-8-10-account-setup-mandates",
      "A penny-drop verification fails but the client insists the account is correct. What should happen?",
      "Do not proceed until the bank account is verified",
      "Accept a cancelled cheque as sufficient proof",
      "Proceed and retry the mandate next month",
      "Register the mandate and verify afterwards",
      "A",
      "Penny-drop failure is unresolved until verified; a mandate on an unverified account causes rejections and misdirected funds.",
      "0.2",
      "1.3",
      "0.25"
    ],
    [
      "M3",
      "day-20-21-elss-transaction-recon",
      "An ELSS purchase is submitted at 14:45 on a business day. Which NAV applies?",
      "The previous business day's NAV",
      "The NAV of the next business day",
      "Whichever NAV is lower on the day",
      "The same business day's NAV, subject to funds realisation",
      "D",
      "Cut-off timing governs which NAV applies, and for purchases it is also conditional on realisation of funds.",
      "0.8",
      "1.4",
      "0.25"
    ],
    [
      "M4",
      "day-22-24-xirr-drift-analysis",
      "A portfolio's equity allocation has drifted from 60% to 72%. What does this indicate?",
      "The client's risk profile has changed",
      "The portfolio needs rebalancing toward the agreed allocation",
      "Equity funds should be switched to debt immediately",
      "The original allocation was set incorrectly",
      "B",
      "Drift is a mechanical consequence of relative performance, not a change in the client's stated risk profile; the response is rebalancing against the agreed allocation.",
      "-0.1",
      "1.1",
      "0.25"
    ]
  ];

  const escape = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  const csv = [COLUMNS.join(","), ...examples.map((row) => row.map(escape).join(","))].join("\n") + "\n";
  writeFileSync("questions-template.csv", csv);

  console.log("  wrote questions-template.csv (5 worked examples)\n");
  console.log("  Open it in Excel or Sheets, replace the examples, one row per question:");
  console.log("    npm run questions:import questions-template.csv          validate only");
  console.log("    npm run questions:import questions-template.csv --apply  load it\n");
  console.log("  What the validator will hold you to:");
  console.log("    correct_key     must vary, roughly a quarter each of A, B, C, D.");
  console.log("                    Fails above 60% on one key: a bank where one letter");
  console.log("                    dominates is passable without reading the questions.");
  console.log("    distractors     specific to the question. Fails if one wrong answer is");
  console.log("                    reused across more than half a module -- repeated filler");
  console.log("                    is recognisable without knowing the subject.");
  console.log("    difficulty      -2 easy to +2 hard, spread out. The adaptive test picks");
  console.log("                    the most informative next item; with no spread there is");
  console.log("                    nothing to choose between.");
  console.log("    discrimination  around 1.0. Higher means the item separates ability more");
  console.log("                    sharply. Leave at 1.0 unless you have response data.");
  console.log("    guessing        0.25 for a four-option item -- the chance of a blind hit.");
  console.log("    sop_slug        must match an existing SOP. See the list below.");
  console.log("    explanation     shown when reviewing a wrong answer. Say why the correct");
  console.log("                    option is correct, not just what it is.\n");
  console.log(`  Target: ${TARGET_BANK_SIZE} questions per module, across M1 to M5.`);
  console.log("  Run 'npm run questions:check' at any time to see where the bank stands.");
}

async function importFile(path: string, apply: boolean, replace: boolean) {
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

  // File first. These are problems with what was written, and always block.
  const fileIssues: Issue[] = drafts.flatMap((d, i) => validateQuestion(d, `row ${i + 2}`));
  fileIssues.push(...validateBank(drafts, "this file", { checkSize: false }));

  console.log("  Checking the file:");
  const fileResult = report(fileIssues);
  if (fileResult.errors) {
    console.log(`\n  ${fileResult.errors} error(s) in the file. Nothing imported.`);
    process.exitCode = 1;
    return;
  }

  // Then the merged result: a file that is balanced on its own can still tip
  // the module it joins.
  const existing = await loadFromDatabase();
  const modulesCovered = new Set(drafts.map((d) => d.module));
  const retained = replace ? existing.filter((q) => !modulesCovered.has(q.module)) : existing;
  const merged = [...retained, ...drafts];

  console.log(`\n  Checking the resulting bank${replace ? " (existing questions in these modules retired)" : ""}:`);
  const mergedResult = report(validateBank(merged, "resulting bank"));

  if (mergedResult.errors) {
    if (!replace) {
      console.log(
        `\n  ${mergedResult.errors} error(s), but the file itself is clean -- these come from` +
          `\n  questions already in the database. Re-run with --replace to retire the existing` +
          `\n  questions in ${[...modulesCovered].sort().join(", ")} and import this file in their place.`
      );
    } else {
      console.log(`\n  ${mergedResult.errors} error(s) remain even after retiring the existing questions.`);
    }
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

  // One transaction: a failed insert must not leave a module with its old
  // questions retired and nothing active in their place.
  let retiredCount = 0;
  await prisma.$transaction(async (tx) => {
    if (replace) {
      // Deactivate rather than delete: ResponseLog references these rows, and
      // past attempts should keep the questions they were actually asked.
      const retired = await tx.questionItem.updateMany({
        where: { module: { in: [...modulesCovered] as never[] }, isActive: true },
        data: { isActive: false }
      });
      retiredCount = retired.count;
    }

    await tx.questionItem.createMany({
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
    await tx.auditLog.create({
      data: {
        actorId: author.id,
        action: "CREATE",
        entity: "QuestionItem",
        summary: `Imported ${drafts.length} questions from ${path}${replace ? `, retiring existing questions in ${[...modulesCovered].sort().join(", ")}` : ""}`
      }
    });
  });
  if (replace)
    console.log(`  retired ${retiredCount} existing question(s) in ${[...modulesCovered].sort().join(", ")}`);
  console.log(`\n  imported ${drafts.length} questions`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "check") return check();
  if (command === "template") return template();
  if (command === "import") {
    const file = rest.find((a) => !a.startsWith("--"));
    if (!file) throw new Error("usage: questions import <file.csv> [--apply]");
    return importFile(file, rest.includes("--apply"), rest.includes("--replace"));
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
