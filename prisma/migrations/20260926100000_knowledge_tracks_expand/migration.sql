-- Knowledge tracks, expand step (runbook §2: expand / migrate / contract).
--
-- Adds tracks, modules and chapters as data, replacing the fixed ModuleCode
-- enum (M1-M5) and the SOP tables. Everything here is additive or relaxes a
-- NOT NULL, so the code already deployed keeps working against it. The code
-- that reads the new shape ships in a later release, and a contract release
-- after that drops the enum columns and the SOP tables.

-- CreateEnum
CREATE TYPE "BadgeLevel" AS ENUM ('SATISFACTORY', 'PROFICIENT', 'EXPERT');

-- AlterTable
ALTER TABLE "certifications" ADD COLUMN     "badgeLevel" "BadgeLevel",
ADD COLUMN     "moduleId" TEXT,
ADD COLUMN     "percentCorrect" DOUBLE PRECISION,
ADD COLUMN     "trackId" TEXT,
ALTER COLUMN "module" DROP NOT NULL,
ALTER COLUMN "level" DROP NOT NULL,
ALTER COLUMN "expiresAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "question_items" ADD COLUMN     "chapterId" TEXT,
ADD COLUMN     "moduleId" TEXT,
ALTER COLUMN "module" DROP NOT NULL,
ALTER COLUMN "linkedSopId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "test_sessions" ADD COLUMN     "moduleId" TEXT,
ADD COLUMN     "trackId" TEXT,
ALTER COLUMN "module" DROP NOT NULL;

-- CreateTable
CREATE TABLE "tracks" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modules" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapters" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter_completions" (
    "userId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chapter_completions_pkey" PRIMARY KEY ("userId","chapterId")
);

-- CreateIndex
CREATE UNIQUE INDEX "tracks_slug_key" ON "tracks"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tracks_order_key" ON "tracks"("order");

-- CreateIndex
CREATE UNIQUE INDEX "modules_trackId_order_key" ON "modules"("trackId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "modules_trackId_slug_key" ON "modules"("trackId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_moduleId_order_key" ON "chapters"("moduleId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_moduleId_slug_key" ON "chapters"("moduleId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "certifications_userId_moduleId_status_key" ON "certifications"("userId", "moduleId", "status");

-- CreateIndex
CREATE INDEX "question_items_moduleId_idx" ON "question_items"("moduleId");

-- CreateIndex
CREATE INDEX "test_sessions_userId_moduleId_idx" ON "test_sessions"("userId", "moduleId");

-- AddForeignKey
ALTER TABLE "modules" ADD CONSTRAINT "modules_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_completions" ADD CONSTRAINT "chapter_completions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_completions" ADD CONSTRAINT "chapter_completions_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_items" ADD CONSTRAINT "question_items_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_items" ADD CONSTRAINT "question_items_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_sessions" ADD CONSTRAINT "test_sessions_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_sessions" ADD CONSTRAINT "test_sessions_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill ---------------------------------------------------------------
--
-- The five existing modules become Track 1, Operational-Excellence. SOP
-- content is not carried over (it is being replaced); each module gets one
-- placeholder chapter so the demo questions have somewhere to link.
--
-- Deterministic ids, so the contract migration can repeat the row updates
-- below for anything the old code wrote after this ran.

INSERT INTO "tracks" ("id", "slug", "title", "order", "updatedAt")
VALUES ('track_operational_excellence', 'operational-excellence', 'Operational-Excellence', 1, CURRENT_TIMESTAMP);

INSERT INTO "modules" ("id", "trackId", "slug", "title", "order", "updatedAt")
SELECT 'module_' || lower(m.code), 'track_operational_excellence', lower(m.code), m.title, m.ord, CURRENT_TIMESTAMP
FROM (VALUES
  ('M1', 'KYC & Compliance', 1),
  ('M2', 'Client Onboarding', 2),
  ('M3', 'Investment Operations', 3),
  ('M4', 'Portfolio Reviews', 4),
  ('M5', 'Full Advisory Certification', 5)
) AS m(code, title, ord);

INSERT INTO "chapters" ("id", "moduleId", "slug", "title", "body", "order", "isPublished", "updatedAt")
SELECT 'chapter_' || m."slug" || '_1', m."id", 'introduction', 'Introduction',
       'Content for this module is on its way.', 1, true, CURRENT_TIMESTAMP
FROM "modules" m
WHERE m."trackId" = 'track_operational_excellence';

UPDATE "question_items"
SET "moduleId" = 'module_' || lower("module"::text),
    "chapterId" = 'chapter_' || lower("module"::text) || '_1'
WHERE "moduleId" IS NULL AND "module" IS NOT NULL;

UPDATE "test_sessions"
SET "trackId" = 'track_operational_excellence',
    "moduleId" = 'module_' || lower("module"::text)
WHERE "moduleId" IS NULL AND "module" IS NOT NULL;

UPDATE "certifications" c
SET "trackId" = 'track_operational_excellence',
    "moduleId" = 'module_' || lower(c."module"::text),
    "badgeLevel" = CASE c."level"
      WHEN 'Expert' THEN 'EXPERT'::"BadgeLevel"
      WHEN 'Proficient' THEN 'PROFICIENT'::"BadgeLevel"
      WHEN 'Foundation' THEN 'SATISFACTORY'::"BadgeLevel"
    END,
    "percentCorrect" = (
      SELECT 100.0 * avg(CASE WHEN r."isCorrect" THEN 1 ELSE 0 END)
      FROM "response_logs" r
      WHERE r."sessionId" = c."sessionId"
    )
WHERE c."moduleId" IS NULL AND c."module" IS NOT NULL;
