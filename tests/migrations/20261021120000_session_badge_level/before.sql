-- Finished attempts as they were stored before badgeLevel existed: one per
-- branch of decide() at the floors of the time (50 / 60 / 70). Each has ten
-- answers, of which `correct` are right. The topic module_m1 and the track
-- track_operational_excellence come from the earlier migrations.
INSERT INTO users (id, name, email, "passwordHash", role, "isActive", "createdAt", "updatedAt")
VALUES
  ('u_admin', 'Admin', 'admin@migration.test', 'x', 'ADMIN', true, now(), now()),
  ('u_adv', 'Advisor', 'advisor@migration.test', 'x', 'ADVISOR', true, now(), now());

INSERT INTO chapters (id, "topicId", slug, title, "order", "isPublished", "updatedAt")
VALUES ('c1', 'module_m1', 'c1', 'C1', 99, true, now());

INSERT INTO question_items (id, content, options, "correctKey", explanation, "createdById", "updatedAt", "chapterId", "topicId")
SELECT 'q' || n, 'Question ' || n, '[{"key":"A","text":"a"}]', 'A', 'Because.', 'u_admin', now(), 'c1', 'module_m1'
FROM generate_series(1, 10) n;

-- (id, certified, theta, se, correct of 10)
CREATE TEMP TABLE cases (id text, certified boolean, theta float, se float, correct int);
INSERT INTO cases VALUES
  ('s_expert', true, 1.9, 0.3, 8),        -- low 1.6, 80%  -> EXPERT
  ('s_expert_band_65', true, 1.9, 0.3, 6), -- low 1.6, 60%  -> PROFICIENT (floor steps down)
  ('s_proficient', true, 1.4, 0.3, 7),     -- low 1.1, 70%  -> PROFICIENT
  ('s_satisfactory', true, 0.9, 0.3, 5),   -- low 0.6, 50%  -> SATISFACTORY
  ('s_edge', true, 1.8, 0.3, 7),           -- low 1.5 exactly, 70% -> EXPERT
  ('s_old_rule', true, 0.6, 0.4, 9),       -- low 0.2: certified pre-D2, not a pass today -> null
  -- s_failed: not certified -> null
  ('s_failed', false, 0.1, 0.3, 3);

INSERT INTO test_sessions (id, "userId", "trackId", "topicId", status, certified, "abilityEstimate", "standardError", "attemptNumber", "completedAt", "timerStartedAt", "updatedAt")
SELECT id, 'u_adv', 'track_operational_excellence', 'module_m1',
       (CASE WHEN certified THEN 'PASSED' ELSE 'FAILED' END)::"TestSessionStatus",
       certified, theta, se, row_number() OVER (ORDER BY id), now(), now(), now()
FROM cases;

INSERT INTO response_logs (id, "sessionId", "questionId", "selectedKey", "isCorrect", "responseTimeMs", "abilityAfter", "seAfter")
SELECT c.id || '_' || n, c.id, 'q' || n, 'A', n <= c.correct, 1000, c.theta, c.se
FROM cases c CROSS JOIN generate_series(1, 10) n;
