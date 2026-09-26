import bcrypt from "bcryptjs";
import { PrismaClient, Prisma } from "@prisma/client";
import { assertDestructiveAllowed, findExcessData } from "../scripts/db-target.mjs";

const prisma = new PrismaClient();

const today = new Date();
const daysAgo = (days: number) => new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
const daysFromNow = (days: number) => new Date(today.getTime() + days * 24 * 60 * 60 * 1000);

/**
 * What this seed creates. If the target database holds more than this, it is
 * not a database this seed produced.
 */
const SEED_VOLUMES = { users: 2, clients: 3, prospects: 3 };

/** Internal keys for the five demo modules; not stored anywhere. */
type ModuleCode = "M1" | "M2" | "M3" | "M4" | "M5";
type ModuleRef = { moduleId: string; chapterId: string };

/**
 * Seed passwords must be supplied explicitly.
 *
 * These were previously `process.env.X || "ChangeMeAdmin123!"`. A default
 * password is not a sensible default: with the variable unset, the seed
 * silently created an account whose password is published in this repository,
 * in .env.example and in this file's own history. Known credentials on a
 * throwaway local database are fine and intentional -- that is what
 * .env.example documents -- but the seed should never invent one.
 *
 * Refusing costs one line in .env.local and removes a whole class of accident.
 */
function requireSeedPassword(variable: string): string {
  const value = process.env[variable];

  if (!value) {
    throw new Error(
      `The database seed refuses to run: ${variable} is not set.\n\n` +
        `  Set it in .env.local. It previously defaulted to a password published in\n` +
        `  this repository, which meant an unset variable silently created an account\n` +
        `  anyone could log in to.\n\n` +
        `  See docs/engineering/runbook.md.`
    );
  }

  return value;
}

/**
 * Second, independent check on top of the hostname classification in
 * scripts/db-target.mjs.
 *
 * Hostname classification cannot see through a tunnel: ssh -L,
 * cloud-sql-proxy and kubectl port-forward all make a production database look
 * like localhost, and the first guard would wave it through. This one asks the
 * database itself what it contains, so a tunnel does not defeat it.
 *
 * A disposable database is empty, or holds no more than this seed creates.
 * Anything beyond that is somebody's real data.
 */
async function assertDatabaseLooksDisposable() {
  const [users, clients, prospects] = await Promise.all([
    prisma.user.count(),
    prisma.client.count(),
    prisma.prospect.count()
  ]);

  const excess = findExcessData({ users, clients, prospects }, SEED_VOLUMES);

  if (excess.length === 0) return;

  if (process.env.ALLOW_DESTRUCTIVE_SEED === "1") {
    console.warn(
      `\n!!  This database holds more data than the seed creates: ${excess.join(", ")}.` +
        `\n!!  ALLOW_DESTRUCTIVE_SEED=1 is set, so it will be deleted anyway.\n`
    );
    return;
  }

  throw new Error(
    "The database seed refuses to run: this database holds more data than the seed creates.\n" +
      `  ${excess.join("\n  ")}\n\n` +
      "  The host looked disposable, but the contents do not. This is what a tunnel to a\n" +
      "  real database looks like (ssh -L, cloud-sql-proxy, kubectl port-forward).\n\n" +
      "  If you genuinely mean to wipe this database, re-run with ALLOW_DESTRUCTIVE_SEED=1.\n" +
      "  See docs/engineering/runbook.md."
  );
}

async function main() {
  // Order matters. Everything that can fail is checked BEFORE clear() deletes
  // any data, cheapest first, so a misconfigured run aborts intact rather than
  // wiping the database and then discovering it cannot finish.

  // 1. Pure, no I/O. Fails instantly on a missing password.
  const adminPassword = requireSeedPassword("SEED_ADMIN_PASSWORD");
  const advisorPassword = requireSeedPassword("SEED_ADVISOR_PASSWORD");

  // 2. Pure. Is this host disposable?
  assertDestructiveAllowed(process.env.DIRECT_URL || process.env.DATABASE_URL, {
    operation: "The database seed"
  });

  // 3. One round-trip. Are the contents disposable? Catches a tunnel, which
  //    step 2 cannot see through. See docs/engineering/runbook.md and adr/0003.
  await assertDatabaseLooksDisposable();

  // Only now is anything destroyed.
  await clear();

  const admin = await prisma.user.create({
    data: {
      email: process.env.SEED_ADMIN_EMAIL || "admin@advisory.local",
      name: "Ananya Rao",
      role: "ADMIN",
      passwordHash: await bcrypt.hash(adminPassword, 12)
    }
  });

  const advisor = await prisma.user.create({
    data: {
      email: process.env.SEED_ADVISOR_EMAIL || "advisor@advisory.local",
      name: "Rohan Mehta",
      role: "ADVISOR",
      passwordHash: await bcrypt.hash(advisorPassword, 12)
    }
  });

  const prospects = await Promise.all([
    prisma.prospect.create({
      data: {
        name: "Meera Iyer",
        phone: "+919876543210",
        source: "REFERRAL",
        firstContactDate: daysAgo(18),
        stage: "PLAN_SENT",
        notes: "Interested in ELSS and SIP split for tax planning before March.",
        followUpDate: daysFromNow(2),
        assignedToId: advisor.id
      }
    }),
    prisma.prospect.create({
      data: {
        name: "Sanjay Kulkarni",
        phone: "+919822011144",
        source: "EVENT",
        firstContactDate: daysAgo(9),
        stage: "MEETING_HELD",
        notes: "Prefers conservative allocation. Needs PAN/KRA verification before onboarding.",
        followUpDate: daysFromNow(5),
        assignedToId: advisor.id
      }
    }),
    prisma.prospect.create({
      data: {
        name: "Neha Shah",
        phone: "+919988776655",
        source: "ONLINE",
        firstContactDate: daysAgo(3),
        stage: "LEAD",
        notes: "Asked for retirement planning consultation.",
        followUpDate: daysFromNow(1),
        assignedToId: admin.id
      }
    })
  ]);

  const clients = await Promise.all([
    prisma.client.create({
      data: {
        name: "Arvind Nair",
        phone: "+919898981122",
        pan: "ABCDE1234F",
        kycStatus: "VERIFIED",
        aum: new Prisma.Decimal(4250000),
        onboardingDate: daysAgo(420),
        assignedToId: advisor.id
      }
    }),
    prisma.client.create({
      data: {
        name: "Priya Menon",
        phone: "+919811122233",
        pan: "PQRSX2345L",
        kycStatus: "PENDING",
        aum: new Prisma.Decimal(1850000),
        onboardingDate: daysAgo(120),
        assignedToId: advisor.id
      }
    }),
    prisma.client.create({
      data: {
        name: "Devendra Joshi",
        phone: "+919765432109",
        pan: "LMNOP9876Q",
        kycStatus: "EXPIRED",
        aum: new Prisma.Decimal(7200000),
        onboardingDate: daysAgo(760),
        assignedToId: admin.id
      }
    })
  ]);

  await prisma.meetingLog.createMany({
    data: [
      {
        kind: "PROSPECT",
        prospectId: prospects[0].id,
        ownerId: advisor.id,
        summary: "ELSS plan walkthrough",
        notes: "Explained lock-in, section 80C limits, and SIP cadence.",
        meetingDate: daysAgo(2),
        followUpDate: daysFromNow(2)
      },
      {
        kind: "PROSPECT",
        prospectId: prospects[1].id,
        ownerId: advisor.id,
        summary: "Initial risk profiling call",
        notes: "Needs low volatility allocation and onboarding checklist.",
        meetingDate: daysAgo(5),
        followUpDate: daysFromNow(5)
      },
      {
        kind: "CLIENT",
        clientId: clients[0].id,
        ownerId: advisor.id,
        summary: "Quarterly SIP review",
        notes: "Continue existing SIPs; revisit mid-cap allocation next quarter.",
        meetingDate: daysAgo(1)
      },
      {
        kind: "REVIEW",
        clientId: clients[2].id,
        ownerId: admin.id,
        summary: "KYC expiry and portfolio rebalance",
        notes: "Re-KYC required before new transactions.",
        meetingDate: daysAgo(7),
        followUpDate: daysFromNow(3)
      }
    ]
  });

  await prisma.investmentPlan.createMany({
    data: [
      {
        clientId: clients[0].id,
        planType: "SIP",
        amount: new Prisma.Decimal(50000),
        frequency: "MONTHLY",
        goal: "WEALTH",
        status: "ACTIVE",
        sentDate: daysAgo(80),
        acceptedDate: daysAgo(75),
        notes: "Blend of flexi-cap, index, and short-duration debt funds."
      },
      {
        clientId: clients[1].id,
        planType: "ELSS",
        amount: new Prisma.Decimal(150000),
        frequency: "ONE_TIME",
        goal: "TAX_SAVING",
        status: "SENT",
        sentDate: daysAgo(4),
        notes: "Awaiting KYC confirmation before execution."
      },
      {
        clientId: clients[2].id,
        planType: "MIXED",
        amount: new Prisma.Decimal(800000),
        frequency: "QUARTERLY",
        goal: "RETIREMENT",
        status: "DRAFT",
        notes: "Hold until re-KYC is complete."
      }
    ]
  });

  await prisma.portfolioReview.createMany({
    data: [
      {
        clientId: clients[0].id,
        reviewDate: daysAgo(1),
        currentAum: new Prisma.Decimal(4250000),
        returns: new Prisma.Decimal(11.8),
        actions: "No immediate rebalance. Watch international allocation drift.",
        nextReviewDate: daysFromNow(88),
        attachmentNote: "Statement PDF placeholder for R2 hardening phase."
      },
      {
        clientId: clients[2].id,
        reviewDate: daysAgo(7),
        currentAum: new Prisma.Decimal(7200000),
        returns: new Prisma.Decimal(8.9),
        actions: "Reduce small-cap exposure after re-KYC completion.",
        nextReviewDate: daysFromNow(30),
        attachmentNote: "Review notes captured internally."
      }
    ]
  });

  const { trackId, modules } = await seedTrack();
  await seedQuestions(admin.id, modules);

  // The advisor has finished module 1: its chapter is ticked and it carries a
  // badge, so module 2 is open in the demo.
  await prisma.chapterCompletion.create({
    data: { userId: advisor.id, chapterId: modules.get("M1")!.chapterId, completedAt: daysAgo(23) }
  });
  const session = await prisma.testSession.create({
    data: {
      userId: advisor.id,
      trackId,
      moduleId: modules.get("M1")!.moduleId,
      abilityEstimate: 1.12,
      standardError: 0.28,
      certified: true,
      status: "PASSED",
      completedAt: daysAgo(22)
    }
  });
  await prisma.certification.create({
    data: {
      userId: advisor.id,
      trackId,
      moduleId: modules.get("M1")!.moduleId,
      sessionId: session.id,
      abilityScore: 1.12,
      badgeLevel: "PROFICIENT",
      issuedAt: daysAgo(22),
      status: "ACTIVE"
    }
  });

  await prisma.auditLog.createMany({
    data: [
      { actorId: admin.id, action: "SEED", entity: "System", summary: "Demo workspace initialized" },
      { actorId: advisor.id, action: "CREATE", entity: "MeetingLog", summary: "Quarterly SIP review" }
    ]
  });
}

/**
 * Track 1 with its five demo modules, one chapter each. Real chapter content
 * comes from the client; these exist so the reader, the locks and the demo
 * questions have something to hang off.
 */
async function seedTrack() {
  const track = await prisma.track.create({
    data: { slug: "operational-excellence", title: "Operational-Excellence", order: 1 }
  });

  const titles: [ModuleCode, string][] = [
    ["M1", "KYC & Compliance"],
    ["M2", "Client Onboarding"],
    ["M3", "Investment Operations"],
    ["M4", "Portfolio Reviews"],
    ["M5", "Full Advisory Certification"]
  ];

  const modules = new Map<ModuleCode, ModuleRef>();
  for (const [index, [code, title]] of titles.entries()) {
    const created = await prisma.module.create({
      data: {
        trackId: track.id,
        slug: code.toLowerCase(),
        title,
        order: index + 1,
        chapters: {
          create: {
            slug: "introduction",
            title: "Introduction",
            order: 1,
            isPublished: true,
            body: demoChapter(title)
          }
        }
      },
      include: { chapters: true }
    });
    modules.set(code, { moduleId: created.id, chapterId: created.chapters[0].id });
  }

  return { trackId: track.id, modules };
}

/** Placeholder text that exercises the formatting a real chapter will use. */
function demoChapter(title: string) {
  return [
    `This is placeholder text for **${title}**. The real chapter content will replace it.`,
    "## What this chapter covers",
    "- The purpose of the process and when it applies",
    "- The steps, in order",
    "- Common mistakes, and how to avoid them",
    "> Read each chapter to the end, then mark it complete to unlock the next one.",
    "| Step | Owner | When |",
    "|---|---|---|",
    "| Collect documents | Advisor | Before onboarding |",
    "| Verify records | Operations | Same day |"
  ].join("\n\n");
}

async function seedQuestions(adminId: string, modules: Map<ModuleCode, ModuleRef>) {
  const stems: Record<ModuleCode, string[]> = {
    M1: [
      "Which record is treated as the first source of truth for PAN-linked identity?",
      "What should happen when the KRA name and master identity name diverge?",
      "Which case requires marriage certificate plus Gazette support?",
      "What should be checked during a KRA fetch?",
      "Why should pending KYC records be flagged before onboarding?",
      "What should be stored after a KRA check?",
      "When is proof protocol triggered?",
      "Which detail should be compared across IT portal, identity proof, and KRA?",
      "What is the safest next step for an expired KYC record?",
      "What is the primary reason for using a repeatable KYC checklist?",
      "Which field should never be casually exposed in list views?",
      "What should an advisor do before creating an active client record?"
    ],
    M2: [
      "What must be confirmed before creating a client record?",
      "Why is the risk profile captured during onboarding?",
      "When should the first portfolio review be scheduled?",
      "Which onboarding detail supports transaction readiness?",
      "What should happen if mandatory KYC checks are incomplete?",
      "Why should onboarding notes include source documents?",
      "Which role can see team-wide onboarding status?",
      "What should be verified for nomination setup?",
      "Which client state comes after successful onboarding?",
      "What is the practical purpose of the onboarding checklist?",
      "Which data should be masked in client lists?",
      "What is a good final onboarding action?"
    ],
    M3: [
      "What should be confirmed before SIP setup?",
      "How should scheme choice be justified?",
      "What plan type best fits section 80C tax planning?",
      "What should be recorded after SIP modification?",
      "When should execution status be updated?",
      "Which plan frequency describes a single purchase?",
      "Why keep plan notes linked to the client?",
      "Which status indicates a plan has been approved by the client?",
      "What should be checked before redemption or switch advice?",
      "Which operational risk is reduced by plan timelines?",
      "What should happen to a draft plan after client approval?",
      "Why should follow-up dates be attached to sent plans?"
    ],
    M4: [
      "What data should be updated before a review meeting?",
      "What does XIRR help an advisor explain?",
      "Which issue can trigger rebalancing discussion?",
      "What must be recorded after rebalancing actions?",
      "When should the next review date be set?",
      "Why compare current allocation with target allocation?",
      "What should a review summary include?",
      "Which client field is updated by review AUM?",
      "What is a common error in portfolio reviews?",
      "Why should client consent be captured?",
      "What should happen after a review finds KYC expiry?",
      "Which view should surface upcoming reviews?"
    ],
    M5: [
      "What is the best first CRM action after receiving a qualified referral?",
      "Which condition should block client activation?",
      "How should an advisor justify an investment plan?",
      "What should happen when a prospect accepts a plan?",
      "Which item best supports auditability across the advisory workflow?",
      "What is the safest action when KYC expires before a new transaction?",
      "Why should review AUM be synced to the client record?",
      "Which signal belongs on the dashboard for day-to-day execution?",
      "What makes a certification attempt defensible?",
      "How should weak test areas be remediated?",
      "Which CRM data should stay masked in list views?",
      "What is the final control before closing a portfolio review?"
    ]
  };

  /**
   * Builds the four options for one question.
   *
   * The previous version put the correct answer at "A" every time and used the
   * same three filler strings as distractors for all 60 questions. That made
   * the certification passable by choosing A repeatedly and reduced every IRT
   * difficulty parameter to noise -- see docs/flags.md.
   *
   * Distractors are now other questions' correct answers from the same module:
   * varied, plausible, and specific to the subject. The correct answer rotates
   * across A, B, C and D. Deterministic, so the seed stays reproducible.
   */
  function buildOptions(module: ModuleCode, index: number, total: number) {
    const correctKey = "ABCD"[index % 4];
    const distractors = [1, 2, 3].map((offset) => correctAnswer(module, (index + offset * 3 + 1) % total));

    let taken = 0;
    const options = ["A", "B", "C", "D"].map((key) => ({
      key,
      text: key === correctKey ? correctAnswer(module, index) : distractors[taken++]
    }));

    return { options, correctKey };
  }

  const rows = (["M1", "M2", "M3", "M4", "M5"] as ModuleCode[]).flatMap((module) =>
    stems[module].map((content, index) => {
      const { options, correctKey } = buildOptions(module, index, stems[module].length);
      return {
        ...modules.get(module)!,
        content,
        options,
        correctKey,
        explanation: "The correct choice preserves a clear, reviewable operating trail.",
        difficulty: -1.8 + (index % 9) * 0.45,
        discrimination: 0.9 + (index % 4) * 0.25,
        guessing: 0.25,
        createdById: adminId,
        isActive: true
      };
    })
  );

  await prisma.questionItem.createMany({ data: rows });
}

function correctAnswer(module: ModuleCode, index: number) {
  const answers: Record<ModuleCode, string[]> = {
    M1: [
      "The IT portal PAN-linked name",
      "Trigger proof protocol before proceeding",
      "Marriage name change",
      "KYC status, IPV status, and last update date",
      "It can block compliant onboarding",
      "A KRA summary in internal notes",
      "When identity names diverge",
      "The client name and PAN identity",
      "Start re-KYC remediation",
      "To reduce onboarding and compliance errors",
      "PAN",
      "Complete mandatory KYC verification"
    ],
    M2: [
      "Identity, PAN, contact, bank, and KYC readiness",
      "To align recommendations with client suitability",
      "Before onboarding is closed",
      "Bank account readiness",
      "Hold client activation until resolved",
      "They support auditability",
      "Admin",
      "Nominee details and supporting client confirmation",
      "Active Client",
      "Consistent and complete client setup",
      "PAN and phone number",
      "Set the first review date"
    ],
    M3: [
      "Mandate availability and investment amount",
      "By linking it to goal and risk profile",
      "ELSS",
      "Start date, frequency, and follow-up date",
      "Immediately after confirmation",
      "One-time",
      "They preserve advisory context",
      "Accepted",
      "Suitability, tax impact, and client consent",
      "Missed implementation follow-ups",
      "Move it to accepted or active status",
      "To prevent plan conversations from stalling"
    ],
    M4: [
      "AUM, XIRR, and goal progress",
      "Performance over irregular cash flows",
      "Allocation drift",
      "Actions and client consent",
      "Before closing the review",
      "To identify drift and concentration risk",
      "Actions, rationale, and next review date",
      "Current AUM",
      "No next review date",
      "It supports audit and suitability review",
      "Start re-KYC before new transactions",
      "Dashboard"
    ],
    M5: [
      "Create the prospect with source, stage, notes, and follow-up",
      "Incomplete mandatory KYC checks",
      "By linking recommendations to goal, risk, and client context",
      "Move the plan through accepted or active status and retain dates",
      "Structured notes, status changes, and linked follow-up dates",
      "Start re-KYC before executing the transaction",
      "It keeps the client summary aligned with the latest review",
      "Upcoming follow-ups, review dates, and certification status",
      "Server-side scoring with a controlled question bank",
      "Review linked SOPs before the next attempt",
      "PAN and phone number",
      "Set actions, consent, and the next review date"
    ]
  };
  return answers[module][index];
}

async function clear() {
  await prisma.certification.deleteMany();
  await prisma.responseLog.deleteMany();
  await prisma.testSession.deleteMany();
  await prisma.questionItem.deleteMany();
  await prisma.chapterCompletion.deleteMany();
  await prisma.chapter.deleteMany();
  await prisma.module.deleteMany();
  await prisma.track.deleteMany();
  // Legacy tables, dropped in the contract release.
  await prisma.sopEntry.deleteMany();
  await prisma.knowledgeCategory.deleteMany();
  await prisma.portfolioReview.deleteMany();
  await prisma.investmentPlan.deleteMany();
  await prisma.meetingLog.deleteMany();
  await prisma.client.deleteMany();
  await prisma.prospect.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
