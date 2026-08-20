import bcrypt from "bcryptjs";
import { PrismaClient, Prisma, ModuleCode } from "@prisma/client";

const prisma = new PrismaClient();

const today = new Date();
const daysAgo = (days: number) => new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
const daysFromNow = (days: number) => new Date(today.getTime() + days * 24 * 60 * 60 * 1000);

async function main() {
  await clear();

  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "ChangeMeAdmin123!";
  const advisorPassword = process.env.SEED_ADVISOR_PASSWORD || "ChangeMeAdvisor123!";

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
        phone: "9876543210",
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
        phone: "9822011144",
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
        phone: "9988776655",
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
        phone: "9898981122",
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
        phone: "9811122233",
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
        phone: "9765432109",
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

  const sopMap = await seedKnowledge();
  await seedQuestions(admin.id, sopMap);

  const session = await prisma.testSession.create({
    data: {
      userId: advisor.id,
      module: "M1",
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
      module: "M1",
      sessionId: session.id,
      abilityScore: 1.12,
      level: "Proficient",
      issuedAt: daysAgo(22),
      expiresAt: daysFromNow(343),
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

async function seedKnowledge() {
  const categories = await Promise.all([
    prisma.knowledgeCategory.create({
      data: {
        title: "KYC & Compliance",
        description: "Identity verification, KRA checks, PAN validation, and re-KYC workflows.",
        order: 1
      }
    }),
    prisma.knowledgeCategory.create({
      data: {
        title: "Client Onboarding",
        description: "Client setup, nomination, bank details, and AMC account readiness.",
        order: 2
      }
    }),
    prisma.knowledgeCategory.create({
      data: {
        title: "Investment Operations",
        description: "SIP, lump sum, ELSS, redemption, and switch operating procedures.",
        order: 3
      }
    }),
    prisma.knowledgeCategory.create({
      data: {
        title: "Portfolio Reviews",
        description: "Review meeting preparation, XIRR checks, and rebalancing decisions.",
        order: 4
      }
    }),
    prisma.knowledgeCategory.create({
      data: {
        title: "Integrated Advisory Practice",
        description: "End-to-end advisory judgment across CRM, compliance, planning, and reviews.",
        order: 5
      }
    })
  ]);

  const entries = await Promise.all([
    prisma.sopEntry.create({
      data: sop(categories[0].id, "M1", "Master Identity Verification", "master-identity-verification", [
        "Open IT portal record and confirm PAN-linked name first.",
        "Compare IT portal name with the master identity document.",
        "Fetch KRA KYC record and compare name, DOB, and PAN.",
        "If names diverge, trigger proof protocol before onboarding."
      ])
    }),
    prisma.sopEntry.create({
      data: sop(categories[0].id, "M1", "KRA Fetch Process", "kra-fetch-process", [
        "Search using PAN in the KRA interface.",
        "Record KYC status, IPV status, and last update date.",
        "Flag pending or expired records for remediation.",
        "Attach KRA summary to the internal onboarding notes."
      ])
    }),
    prisma.sopEntry.create({
      data: sop(categories[1].id, "M2", "New Client Checklist", "new-client-checklist", [
        "Confirm identity, PAN, phone, email, and bank account readiness.",
        "Verify risk profile and investment objective.",
        "Create client record only after mandatory KYC checks pass.",
        "Schedule first review before concluding onboarding."
      ])
    }),
    prisma.sopEntry.create({
      data: sop(categories[2].id, "M3", "SIP Setup & Modification", "sip-setup-modification", [
        "Confirm mandate availability and investment amount.",
        "Match scheme choice to documented goal and risk profile.",
        "Record start date, frequency, and follow-up date.",
        "Confirm execution status in the client timeline."
      ])
    }),
    prisma.sopEntry.create({
      data: sop(categories[3].id, "M4", "Review Meeting Checklist", "review-meeting-checklist", [
        "Update AUM, XIRR, and goal progress before the meeting.",
        "Identify allocation drift and fund underperformance.",
        "Record rebalancing actions and client consent.",
        "Set the next review date before closing the review."
      ])
    }),
    prisma.sopEntry.create({
      data: sop(categories[4].id, "M5", "Full Advisory Workflow", "full-advisory-workflow", [
        "Qualify the prospect and record source, stage, notes, and next action.",
        "Complete KYC and onboarding controls before activating a client.",
        "Create a suitable plan linked to the documented goal and risk context.",
        "Review portfolio outcomes and update the next operating action."
      ])
    })
  ]);

  return new Map(entries.map((entry) => [entry.module || "M1", entry.id] as [ModuleCode, string]));
}

function sop(categoryId: string, module: ModuleCode, title: string, slug: string, steps: string[]) {
  return {
    categoryId,
    module,
    title,
    slug,
    what: `${title} gives advisors a repeatable control point for compliant client servicing.`,
    when: "Use this whenever the relevant client or operational event occurs.",
    steps,
    outcomes: ["Clean audit trail", "Reduced follow-up misses", "Advisor-ready client context"],
    commonErrors: ["Skipping source-of-truth checks", "Leaving follow-up dates blank", "Recording only informal notes"],
    references: ["Internal SOP v1.2", "PRD Knowledge Portal structure"]
  };
}

async function seedQuestions(adminId: string, sopMap: Map<ModuleCode, string>) {
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
    ],
  };

  const rows = (["M1", "M2", "M3", "M4", "M5"] as ModuleCode[]).flatMap((module) =>
    stems[module].map((content, index) => ({
      module,
      content,
      options: [
        { key: "A", text: correctAnswer(module, index) },
        { key: "B", text: "Record it informally and decide later" },
        { key: "C", text: "Skip the step when the client is familiar" },
        { key: "D", text: "Wait until month-end reporting" }
      ],
      correctKey: "A",
      explanation: "The correct choice preserves a clear, reviewable operating trail.",
      difficulty: -1.2 + (index % 6) * 0.45,
      discrimination: 0.9 + (index % 4) * 0.25,
      guessing: 0.2,
      linkedSopId: sopMap.get(module)!,
      createdById: adminId,
      isActive: true
    }))
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
    ],
  };
  return answers[module][index];
}

async function clear() {
  await prisma.certification.deleteMany();
  await prisma.responseLog.deleteMany();
  await prisma.testSession.deleteMany();
  await prisma.questionItem.deleteMany();
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
