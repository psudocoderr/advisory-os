-- Knowledge restructure (decisions.md 2026-10-17): track > module > topic >
-- chapter.
--
-- Today's modules become topics: the "modules" table is renamed to "topics"
-- and every moduleId column to topicId. A new "modules" table goes between
-- tracks and topics, with one module, Operational Excellence, per existing
-- track, holding that track's topics in their current order. Tracks stay
-- tracks, so every test session's and certification's trackId stays valid.
-- Topics gain isPublished (true for every existing row, so nothing
-- disappears).
--
-- Renames only: no row is copied or recreated, and every id, attempt, badge,
-- completion and asset keeps its links. Do not replace this with Prisma's
-- generated diff, which drops the moduleId columns and adds empty topicId
-- ones.
--
-- Prisma sends this file as one multi-statement query, which Postgres runs as
-- one transaction: if any statement fails, nothing has changed.
--
-- Deploy order: the app must be the new code when this runs, and vice versa
-- (the old code reads "modules"."trackId", which is gone). Ship it in the
-- maintenance window: deploy, then approve the migration straight away.

-- 1. The empty "Operational Excellence" row added in the editor on 2026-10-17
--    stood in for the new module level. It would otherwise become an empty
--    topic. Removed only while it still owns nothing.
DELETE FROM "modules" AS "m"
WHERE "m"."slug" = 'operational-excellence'
  AND NOT EXISTS (SELECT 1 FROM "chapters" WHERE "moduleId" = "m"."id")
  AND NOT EXISTS (SELECT 1 FROM "question_items" WHERE "moduleId" = "m"."id")
  AND NOT EXISTS (SELECT 1 FROM "test_sessions" WHERE "moduleId" = "m"."id")
  AND NOT EXISTS (SELECT 1 FROM "certifications" WHERE "moduleId" = "m"."id");

-- 2. modules -> topics. Foreign keys pointing at the table follow the rename.
ALTER TABLE "modules" RENAME TO "topics";
ALTER TABLE "topics" RENAME CONSTRAINT "modules_pkey" TO "topics_pkey";
-- Its track-scoped indexes and key go now, so the new modules table can use
-- those names. The trackId column stays until step 4 has read it.
ALTER TABLE "topics" DROP CONSTRAINT "modules_trackId_fkey";
DROP INDEX "modules_trackId_order_key";
DROP INDEX "modules_trackId_slug_key";

-- 3. The new module level.
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
CREATE UNIQUE INDEX "modules_trackId_order_key" ON "modules"("trackId", "order");
CREATE UNIQUE INDEX "modules_trackId_slug_key" ON "modules"("trackId", "slug");
ALTER TABLE "modules" ADD CONSTRAINT "modules_trackId_fkey"
  FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "modules" ("id", "trackId", "slug", "title", "order", "updatedAt")
SELECT 'module_' || "id", "id", 'operational-excellence', 'Operational Excellence', 1, CURRENT_TIMESTAMP
FROM "tracks";

-- 4. Topics hang off a module instead of a track.
ALTER TABLE "topics" ADD COLUMN "moduleId" TEXT;
UPDATE "topics" SET "moduleId" = 'module_' || "trackId";
ALTER TABLE "topics" ALTER COLUMN "moduleId" SET NOT NULL;
ALTER TABLE "topics" DROP COLUMN "trackId";

CREATE UNIQUE INDEX "topics_moduleId_order_key" ON "topics"("moduleId", "order");
CREATE UNIQUE INDEX "topics_moduleId_slug_key" ON "topics"("moduleId", "slug");
ALTER TABLE "topics" ADD CONSTRAINT "topics_moduleId_fkey"
  FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "topics" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true;

-- 5. moduleId -> topicId everywhere else. Index definitions, including the
--    partial ones, follow the column rename; only their names change.
ALTER TABLE "chapters" RENAME COLUMN "moduleId" TO "topicId";
ALTER TABLE "chapters" RENAME CONSTRAINT "chapters_moduleId_fkey" TO "chapters_topicId_fkey";
ALTER INDEX "chapters_moduleId_order_key" RENAME TO "chapters_topicId_order_key";
ALTER INDEX "chapters_moduleId_slug_key" RENAME TO "chapters_topicId_slug_key";

ALTER TABLE "question_items" RENAME COLUMN "moduleId" TO "topicId";
ALTER TABLE "question_items" RENAME CONSTRAINT "question_items_moduleId_fkey" TO "question_items_topicId_fkey";
ALTER INDEX "question_items_moduleId_idx" RENAME TO "question_items_topicId_idx";

ALTER TABLE "test_sessions" RENAME COLUMN "moduleId" TO "topicId";
ALTER TABLE "test_sessions" RENAME CONSTRAINT "test_sessions_moduleId_fkey" TO "test_sessions_topicId_fkey";
ALTER INDEX "test_sessions_userId_moduleId_idx" RENAME TO "test_sessions_userId_topicId_idx";
ALTER INDEX "test_sessions_one_open_module_test_key" RENAME TO "test_sessions_one_open_topic_test_key";

ALTER TABLE "certifications" RENAME COLUMN "moduleId" TO "topicId";
ALTER TABLE "certifications" RENAME CONSTRAINT "certifications_moduleId_fkey" TO "certifications_topicId_fkey";
ALTER INDEX "certifications_userId_moduleId_status_key" RENAME TO "certifications_userId_topicId_status_key";
