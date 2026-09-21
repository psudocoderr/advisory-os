-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'ADVISOR');

-- CreateEnum
CREATE TYPE "ProspectSource" AS ENUM ('REFERRAL', 'WALK_IN', 'EVENT', 'ONLINE');

-- CreateEnum
CREATE TYPE "ProspectStage" AS ENUM ('LEAD', 'MEETING_HELD', 'PLAN_SENT', 'ONBOARDED', 'DROPPED');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('VERIFIED', 'PENDING', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MeetingKind" AS ENUM ('PROSPECT', 'CLIENT', 'PLAN', 'REVIEW');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('SIP', 'LUMP_SUM', 'ELSS', 'MIXED');

-- CreateEnum
CREATE TYPE "PlanFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "PlanGoal" AS ENUM ('RETIREMENT', 'EDUCATION', 'WEALTH', 'TAX_SAVING', 'OTHER');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ModuleCode" AS ENUM ('M1', 'M2', 'M3', 'M4', 'M5');

-- CreateEnum
CREATE TYPE "TestSessionStatus" AS ENUM ('IN_PROGRESS', 'PASSED', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "CertificationStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ADVISOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "source" "ProspectSource" NOT NULL,
    "firstContactDate" TIMESTAMP(3) NOT NULL,
    "stage" "ProspectStage" NOT NULL DEFAULT 'LEAD',
    "notes" TEXT NOT NULL,
    "followUpDate" TIMESTAMP(3),
    "assignedToId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "pan" TEXT NOT NULL,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "aum" DECIMAL(18,2) NOT NULL,
    "onboardingDate" TIMESTAMP(3) NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_logs" (
    "id" TEXT NOT NULL,
    "kind" "MeetingKind" NOT NULL,
    "summary" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "meetingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followUpDate" TIMESTAMP(3),
    "ownerId" TEXT NOT NULL,
    "prospectId" TEXT,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_plans" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "planType" "PlanType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "frequency" "PlanFrequency" NOT NULL,
    "goal" "PlanGoal" NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "sentDate" TIMESTAMP(3),
    "acceptedDate" TIMESTAMP(3),
    "notes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_reviews" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reviewDate" TIMESTAMP(3) NOT NULL,
    "currentAum" DECIMAL(18,2) NOT NULL,
    "returns" DECIMAL(8,2) NOT NULL,
    "actions" TEXT NOT NULL,
    "nextReviewDate" TIMESTAMP(3) NOT NULL,
    "attachmentNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_categories" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sop_entries" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "module" "ModuleCode",
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "when" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "outcomes" JSONB NOT NULL,
    "commonErrors" JSONB NOT NULL,
    "references" JSONB NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sop_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_items" (
    "id" TEXT NOT NULL,
    "module" "ModuleCode" NOT NULL,
    "content" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctKey" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "difficulty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discrimination" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "guessing" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "linkedSopId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" "ModuleCode" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "abilityEstimate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "standardError" DOUBLE PRECISION NOT NULL DEFAULT 99,
    "certified" BOOLEAN NOT NULL DEFAULT false,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "TestSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "response_logs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedKey" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "responseTimeMs" INTEGER NOT NULL,
    "abilityAfter" DOUBLE PRECISION NOT NULL,
    "seAfter" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "response_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" "ModuleCode" NOT NULL,
    "sessionId" TEXT NOT NULL,
    "abilityScore" DOUBLE PRECISION NOT NULL,
    "level" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "CertificationStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "certifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "prospects_stage_idx" ON "prospects"("stage");

-- CreateIndex
CREATE INDEX "prospects_assignedToId_idx" ON "prospects"("assignedToId");

-- CreateIndex
CREATE INDEX "clients_kycStatus_idx" ON "clients"("kycStatus");

-- CreateIndex
CREATE INDEX "clients_assignedToId_idx" ON "clients"("assignedToId");

-- CreateIndex
CREATE INDEX "meeting_logs_meetingDate_idx" ON "meeting_logs"("meetingDate");

-- CreateIndex
CREATE INDEX "meeting_logs_ownerId_idx" ON "meeting_logs"("ownerId");

-- CreateIndex
CREATE INDEX "investment_plans_status_idx" ON "investment_plans"("status");

-- CreateIndex
CREATE INDEX "portfolio_reviews_nextReviewDate_idx" ON "portfolio_reviews"("nextReviewDate");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_categories_order_key" ON "knowledge_categories"("order");

-- CreateIndex
CREATE UNIQUE INDEX "sop_entries_slug_key" ON "sop_entries"("slug");

-- CreateIndex
CREATE INDEX "sop_entries_module_idx" ON "sop_entries"("module");

-- CreateIndex
CREATE INDEX "question_items_module_idx" ON "question_items"("module");

-- CreateIndex
CREATE INDEX "test_sessions_userId_module_idx" ON "test_sessions"("userId", "module");

-- CreateIndex
CREATE UNIQUE INDEX "response_logs_sessionId_questionId_key" ON "response_logs"("sessionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "certifications_sessionId_key" ON "certifications"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "certifications_userId_module_status_key" ON "certifications"("userId", "module", "status");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_logs" ADD CONSTRAINT "meeting_logs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_logs" ADD CONSTRAINT "meeting_logs_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_logs" ADD CONSTRAINT "meeting_logs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_plans" ADD CONSTRAINT "investment_plans_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_reviews" ADD CONSTRAINT "portfolio_reviews_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_entries" ADD CONSTRAINT "sop_entries_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "knowledge_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_items" ADD CONSTRAINT "question_items_linkedSopId_fkey" FOREIGN KEY ("linkedSopId") REFERENCES "sop_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_items" ADD CONSTRAINT "question_items_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_sessions" ADD CONSTRAINT "test_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_logs" ADD CONSTRAINT "response_logs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "test_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_logs" ADD CONSTRAINT "response_logs_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "question_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "test_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

