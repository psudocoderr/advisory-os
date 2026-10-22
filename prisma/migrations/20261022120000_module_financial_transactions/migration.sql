-- Module 2, "Financial Transactions", empty for now: topics and chapters are
-- added in the knowledge editor. Until it has a published chapter the track
-- page shows it as "Coming Soon....", and as locked to anyone without the
-- Module 1 badge. Modules are created by migration (the editor cannot yet).
--
-- The track is found by its Operational Excellence module, not by its own
-- slug, which the editor can change (production's is "foundations"). Skipped
-- where that module does not exist, and where Module 2 already does.
INSERT INTO "modules" ("id", "trackId", "slug", "title", "order", "updatedAt")
SELECT gen_random_uuid()::text, m."trackId", 'financial-transactions', 'Financial Transactions',
       (SELECT max("order") + 1 FROM "modules" WHERE "trackId" = m."trackId"), now()
FROM "modules" m
WHERE m."slug" = 'operational-excellence'
  AND NOT EXISTS (
    SELECT 1 FROM "modules" x WHERE x."trackId" = m."trackId" AND x."slug" = 'financial-transactions'
  );
