-- Knowledge tracks, migrate step. Data only; no schema change.
--
-- Between the expand release and this one, the code still deployed wrote
-- questions, test sessions and certifications with only the legacy ModuleCode
-- column set. This links them to their module and chapter, as the expand
-- backfill did for everything before it. Idempotent: rows already linked are
-- left alone. Matches on slugs rather than ids, so it holds on a database the
-- seed rebuilt as well as on one the expand migration populated.

UPDATE "question_items" q
SET "moduleId" = m."id",
    "chapterId" = COALESCE(q."chapterId", (
      SELECT c."id" FROM "chapters" c WHERE c."moduleId" = m."id" ORDER BY c."order" LIMIT 1
    ))
FROM "modules" m
JOIN "tracks" t ON t."id" = m."trackId"
WHERE t."slug" = 'operational-excellence'
  AND m."slug" = lower(q."module"::text)
  AND q."moduleId" IS NULL;

UPDATE "test_sessions" s
SET "trackId" = m."trackId",
    "moduleId" = m."id"
FROM "modules" m
JOIN "tracks" t ON t."id" = m."trackId"
WHERE t."slug" = 'operational-excellence'
  AND m."slug" = lower(s."module"::text)
  AND s."moduleId" IS NULL;

UPDATE "certifications" c
SET "trackId" = m."trackId",
    "moduleId" = m."id",
    "badgeLevel" = COALESCE(c."badgeLevel", CASE c."level"
      WHEN 'Expert' THEN 'EXPERT'::"BadgeLevel"
      WHEN 'Proficient' THEN 'PROFICIENT'::"BadgeLevel"
      WHEN 'Foundation' THEN 'SATISFACTORY'::"BadgeLevel"
    END),
    "percentCorrect" = COALESCE(c."percentCorrect", (
      SELECT 100.0 * avg(CASE WHEN r."isCorrect" THEN 1 ELSE 0 END)
      FROM "response_logs" r
      WHERE r."sessionId" = c."sessionId"
    ))
FROM "modules" m
JOIN "tracks" t ON t."id" = m."trackId"
WHERE t."slug" = 'operational-excellence'
  AND m."slug" = lower(c."module"::text)
  AND c."moduleId" IS NULL;
