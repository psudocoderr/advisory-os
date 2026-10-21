-- Store the level each attempt passed at.
--
-- Until now the result page, the trainee report and the finish API worked a
-- past attempt's level out again from theta, SE and percent correct with the
-- floors in force today, so raising a floor would relabel old passes.
ALTER TABLE "test_sessions" ADD COLUMN "badgeLevel" "BadgeLevel";

-- Backfill certified attempts with the level they show today: decide() in
-- src/lib/irt.ts at the floors of the time (Satisfactory 50, Proficient 60,
-- Expert 70). The pessimistic end, theta - SE, picks the band; the level then
-- drops band by band until its percent-correct floor is met. A certified
-- attempt that does not pass this rule (pre-D2 data) stays null, which is
-- what it shows today.
WITH scored AS (
  SELECT s.id,
         s."abilityEstimate" - s."standardError" AS low,
         100.0 * count(*) FILTER (WHERE r."isCorrect") / count(*) AS pct
  FROM "test_sessions" s
  JOIN "response_logs" r ON r."sessionId" = s.id
  WHERE s.certified
  GROUP BY s.id
)
UPDATE "test_sessions" t
SET "badgeLevel" = (CASE
  WHEN low >= 1.5 AND pct >= 70 THEN 'EXPERT'
  WHEN low >= 1.0 AND pct >= 60 THEN 'PROFICIENT'
  WHEN low >= 0.5 AND pct >= 50 THEN 'SATISFACTORY'
END)::"BadgeLevel"
FROM scored
WHERE t.id = scored.id;
