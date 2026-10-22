-- Cross-table rules the app keeps, now enforced by the database (flags O21),
-- so a script or Prisma Studio cannot break them either:
--   1. a question's chapter belongs to the question's topic;
--   2. a test session's or certification's topic is in its track, and no
--      edit to modules or topics can move one out from under it;
--   3. a meeting belongs to exactly one prospect or one client.
--
-- Current code satisfies all three, so this ships ahead of nothing (expand
-- only). Rule 1 is in schema.prisma; rules 2 and 3 are SQL only, which
-- `prisma migrate diff` ignores (no drift), and are documented on the models.

-- Refuse to start on rows that already break a rule, naming the count, so a
-- failed run says what to fix instead of a bare constraint error.
DO $$
DECLARE
  bad_questions int;
  bad_sessions int;
  bad_certifications int;
  bad_meetings int;
BEGIN
  SELECT count(*) INTO bad_questions
  FROM "question_items" q JOIN "chapters" c ON c."id" = q."chapterId"
  WHERE c."topicId" <> q."topicId";

  SELECT count(*) INTO bad_sessions
  FROM "test_sessions" s JOIN "topics" t ON t."id" = s."topicId" JOIN "modules" m ON m."id" = t."moduleId"
  WHERE m."trackId" <> s."trackId";

  SELECT count(*) INTO bad_certifications
  FROM "certifications" x JOIN "topics" t ON t."id" = x."topicId" JOIN "modules" m ON m."id" = t."moduleId"
  WHERE m."trackId" <> x."trackId";

  SELECT count(*) INTO bad_meetings
  FROM "meeting_logs" WHERE num_nonnulls("prospectId", "clientId") <> 1;

  IF bad_questions + bad_sessions + bad_certifications + bad_meetings > 0 THEN
    RAISE EXCEPTION 'O21: existing rows break the new rules: % questions in another topic''s chapter, % test sessions and % certifications whose topic is outside their track, % meetings without exactly one prospect or client',
      bad_questions, bad_sessions, bad_certifications, bad_meetings;
  END IF;
END $$;

-- 1. Question chapter in question topic.
CREATE UNIQUE INDEX "chapters_id_topicId_key" ON "chapters"("id", "topicId");

ALTER TABLE "question_items" ADD CONSTRAINT "question_items_chapterId_topicId_fkey"
  FOREIGN KEY ("chapterId", "topicId") REFERENCES "chapters"("id", "topicId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "question_items" DROP CONSTRAINT "question_items_chapterId_fkey";

-- 2. Topic in track. Two hops (topic > module > track), so a foreign key
-- cannot express it. A final exam (topicId NULL) has no topic to check.
CREATE FUNCTION "check_topic_in_track"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."topicId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "topics" t JOIN "modules" m ON m."id" = t."moduleId"
    WHERE t."id" = NEW."topicId" AND m."trackId" = NEW."trackId"
  ) THEN
    RAISE EXCEPTION '%: topic % is not in track %', TG_TABLE_NAME, NEW."topicId", NEW."trackId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "test_sessions_topic_in_track" BEFORE INSERT OR UPDATE OF "topicId", "trackId" ON "test_sessions"
  FOR EACH ROW EXECUTE FUNCTION "check_topic_in_track"();

CREATE TRIGGER "certifications_topic_in_track" BEFORE INSERT OR UPDATE OF "topicId", "trackId" ON "certifications"
  FOR EACH ROW EXECUTE FUNCTION "check_topic_in_track"();

-- The other side of rule 2: the editor never moves a module to another
-- track or a topic to a module in another track, and nothing else may.
CREATE FUNCTION "refuse_module_track_move"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'modules: % cannot move to another track', OLD."id" USING ERRCODE = 'check_violation';
END $$;

CREATE FUNCTION "refuse_topic_track_move"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT "trackId" FROM "modules" WHERE "id" = OLD."moduleId")
     IS DISTINCT FROM (SELECT "trackId" FROM "modules" WHERE "id" = NEW."moduleId") THEN
    RAISE EXCEPTION 'topics: % cannot move to a module in another track', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "modules_stay_in_track" BEFORE UPDATE OF "trackId" ON "modules"
  FOR EACH ROW WHEN (OLD."trackId" IS DISTINCT FROM NEW."trackId") EXECUTE FUNCTION "refuse_module_track_move"();

CREATE TRIGGER "topics_stay_in_track" BEFORE UPDATE OF "moduleId" ON "topics"
  FOR EACH ROW WHEN (OLD."moduleId" IS DISTINCT FROM NEW."moduleId") EXECUTE FUNCTION "refuse_topic_track_move"();

-- 3. One subject per meeting.
ALTER TABLE "meeting_logs" ADD CONSTRAINT "meeting_logs_one_subject_check"
  CHECK (num_nonnulls("prospectId", "clientId") = 1);
