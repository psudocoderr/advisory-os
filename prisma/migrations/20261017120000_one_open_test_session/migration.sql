-- At most one open (IN_PROGRESS) attempt per user per test (flags D14).
--
-- The start route checks for an open attempt and then creates one in
-- separate statements, so two simultaneous Start requests could both see
-- none and each create an attempt: a candidate could sit the test twice and
-- keep the better result. These indexes make the second insert fail; the
-- route catches that and hands back the attempt that won.
--
-- Two indexes, because a final exam has no module: Postgres treats NULL
-- moduleIds as distinct, so the module index alone would not cover finals
-- (the same reason as certifications_track_certificate_key).
--
-- Prisma cannot express a partial index; schema.prisma documents these on
-- the TestSession model, and `prisma migrate diff` ignores them (no drift).

-- Close any duplicates already there, or the indexes cannot be built. The
-- newest open attempt per user and test is kept (it is the one the start
-- route resumes); older ones become ABANDONED, which is not counted as an
-- attempt and does not start the retry cooldown.
UPDATE "test_sessions" SET "status" = 'ABANDONED', "completedAt" = NOW()
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "userId", "trackId", "moduleId" ORDER BY "startedAt" DESC, "id" DESC
    ) AS "rank"
    FROM "test_sessions"
    WHERE "status" = 'IN_PROGRESS'
  ) AS "open"
  WHERE "rank" > 1
);

CREATE UNIQUE INDEX "test_sessions_one_open_module_test_key"
  ON "test_sessions" ("userId", "moduleId")
  WHERE "status" = 'IN_PROGRESS' AND "moduleId" IS NOT NULL;

CREATE UNIQUE INDEX "test_sessions_one_open_final_exam_key"
  ON "test_sessions" ("userId", "trackId")
  WHERE "status" = 'IN_PROGRESS' AND "moduleId" IS NULL;
