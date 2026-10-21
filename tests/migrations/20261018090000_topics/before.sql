-- Track > module > chapter, as production was before topics. The earlier
-- migrations already created the "operational-excellence" track
-- (track_operational_excellence) with modules module_m1..module_m5, as on
-- production. Added here: the empty "operational-excellence" placeholder
-- module made in the editor on 2026-10-17 (the migration removes it), a
-- second track whose module has that slug but owns a chapter (it must
-- survive), and an advisor with a finished attempt, a badge, a completion,
-- an answer, a file and an open attempt.
INSERT INTO users (id, name, email, "passwordHash", role, "isActive", "createdAt", "updatedAt")
VALUES
  ('u_admin', 'Admin', 'admin@migration.test', 'x', 'ADMIN', true, now(), now()),
  ('u_adv', 'Advisor', 'advisor@migration.test', 'x', 'ADVISOR', true, now(), now());

INSERT INTO tracks (id, slug, title, "order", "updatedAt") VALUES ('t2', 'advanced', 'Advanced', 2, now());

INSERT INTO modules (id, "trackId", slug, title, "order", "updatedAt")
VALUES
  ('m_placeholder', 'track_operational_excellence', 'operational-excellence', 'Operational Excellence', 6, now()),
  ('m_keep', 't2', 'operational-excellence', 'Operational Excellence (in use)', 1, now());

INSERT INTO chapters (id, "moduleId", slug, title, "order", "isPublished", "updatedAt")
VALUES
  ('c_kyc', 'module_m1', 'kyc-extra', 'KYC extra', 99, true, now()),
  ('c_keep', 'm_keep', 'kept', 'Kept', 1, false, now());

INSERT INTO question_items (id, content, options, "correctKey", explanation, "createdById", "updatedAt", "chapterId", "moduleId")
VALUES ('q1', 'A question?', '[{"key":"A","text":"a"}]', 'A', 'Because.', 'u_admin', now(), 'c_kyc', 'module_m1');

INSERT INTO test_sessions (id, "userId", "trackId", "moduleId", status, certified, "completedAt", "timerStartedAt", "updatedAt")
VALUES
  ('s_passed', 'u_adv', 'track_operational_excellence', 'module_m1', 'PASSED', true, now(), now(), now()),
  ('s_open', 'u_adv', 'track_operational_excellence', 'module_m2', 'IN_PROGRESS', false, NULL, NULL, now());

INSERT INTO response_logs (id, "sessionId", "questionId", "selectedKey", "isCorrect", "responseTimeMs", "abilityAfter", "seAfter")
VALUES ('r1', 's_passed', 'q1', 'A', true, 1000, 1.5, 0.3);

INSERT INTO certifications (id, "userId", "sessionId", "abilityScore", status, "badgeLevel", "moduleId", "percentCorrect", "trackId")
VALUES ('cert1', 'u_adv', 's_passed', 1.5, 'ACTIVE', 'PROFICIENT', 'module_m1', 100, 'track_operational_excellence');

INSERT INTO chapter_completions ("userId", "chapterId") VALUES ('u_adv', 'c_kyc');

INSERT INTO assets (id, "chapterId", key, filename, "contentType", size, "uploadedById")
VALUES ('a1', 'c_kyc', 'chapters/c_kyc/x.pdf', 'Guide.pdf', 'application/pdf', 3, 'u_admin');
