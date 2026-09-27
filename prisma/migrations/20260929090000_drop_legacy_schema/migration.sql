-- Knowledge tracks, contract step (plan PR 10b). IRREVERSIBLE.
--
-- Drops what the tracks/modules/chapters model replaced: the SOP tables, the
-- ModuleCode enum and its columns, certifications.level and expiresAt, and
-- question_items.linkedSopId. Makes the new links required: every question
-- has a module and a chapter; every test session and certification has a
-- track (moduleId stays optional: NULL is the final exam / track certificate).
--
-- Ship only after PR 10a is live: from 10a on, the app neither reads nor
-- writes anything dropped here, so deploy order does not matter.
-- Take a production backup before approving this migration.
--
-- Guard first: if any row would break a NOT NULL, or any certification would
-- lose its only level (a legacy `level` the backfill could not map), stop
-- before changing anything and say what was found.
--
-- If it refuses: nothing has changed, but Prisma records the attempt as failed
-- (P3018) and blocks later migrations. Fix the rows it names, then
--   npx prisma migrate resolve --rolled-back 20260929090000_drop_legacy_schema
-- against that database, and re-run the workflow.
DO $$
DECLARE
  q_module  int := (SELECT count(*) FROM "question_items" WHERE "moduleId" IS NULL);
  q_chapter int := (SELECT count(*) FROM "question_items" WHERE "chapterId" IS NULL);
  s_track   int := (SELECT count(*) FROM "test_sessions" WHERE "trackId" IS NULL);
  c_track   int := (SELECT count(*) FROM "certifications" WHERE "trackId" IS NULL);
  c_level   int := (SELECT count(*) FROM "certifications" WHERE "badgeLevel" IS NULL AND "level" IS NOT NULL);
BEGIN
  IF q_module + q_chapter + s_track + c_track + c_level > 0 THEN
    RAISE EXCEPTION 'Contract migration refused, nothing changed. Unlinked rows: question_items without moduleId %, without chapterId %; test_sessions without trackId %; certifications without trackId %; certifications whose legacy level has no badgeLevel %. Link or remove them, then re-run.',
      q_module, q_chapter, s_track, c_track, c_level;
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "sop_entries" DROP CONSTRAINT "sop_entries_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "question_items" DROP CONSTRAINT "question_items_linkedSopId_fkey";

-- DropIndex
DROP INDEX "question_items_module_idx";

-- DropIndex
DROP INDEX "test_sessions_userId_module_idx";

-- DropIndex
DROP INDEX "certifications_userId_module_status_key";

-- AlterTable
ALTER TABLE "question_items" DROP COLUMN "linkedSopId",
DROP COLUMN "module",
ALTER COLUMN "moduleId" SET NOT NULL,
ALTER COLUMN "chapterId" SET NOT NULL;

-- AlterTable
ALTER TABLE "test_sessions" DROP COLUMN "module",
ALTER COLUMN "trackId" SET NOT NULL;

-- AlterTable
ALTER TABLE "certifications" DROP COLUMN "expiresAt",
DROP COLUMN "level",
DROP COLUMN "module",
ALTER COLUMN "trackId" SET NOT NULL;

-- DropTable
DROP TABLE "knowledge_categories";

-- DropTable
DROP TABLE "sop_entries";

-- DropEnum
DROP TYPE "ModuleCode";

