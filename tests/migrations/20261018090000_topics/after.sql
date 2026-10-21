-- each old module is now a topic, except the empty placeholder
SELECT array_agg(id ORDER BY id) = ARRAY['m_keep', 'module_m1', 'module_m2', 'module_m3', 'module_m4', 'module_m5'] AS ok,
       array_agg(id ORDER BY id) AS detail
FROM topics;

-- one new "Operational Excellence" module per track
SELECT array_agg(id || ':' || "trackId" || ':' || slug ORDER BY id)
     = ARRAY['module_t2:t2:operational-excellence',
             'module_track_operational_excellence:track_operational_excellence:operational-excellence'] AS ok,
       array_agg(id ORDER BY id) AS detail
FROM modules;

-- topics sit under their track's module, in their old order, all published
SELECT bool_and("moduleId" = CASE WHEN id = 'm_keep' THEN 'module_t2' ELSE 'module_track_operational_excellence' END)
   AND (SELECT "order" FROM topics WHERE id = 'module_m2') = 2
   AND bool_and("isPublished") AS ok,
       array_agg(id || '>' || "moduleId" || '#' || "order") AS detail
FROM topics;

-- chapters, questions, attempts and badges point at the same rows as before
SELECT (SELECT "topicId" FROM chapters WHERE id = 'c_kyc') = 'module_m1'
   AND (SELECT "topicId" FROM chapters WHERE id = 'c_keep') = 'm_keep'
   AND (SELECT "topicId" FROM question_items WHERE id = 'q1') = 'module_m1'
   AND (SELECT "topicId" || '/' || "trackId" FROM test_sessions WHERE id = 's_passed') = 'module_m1/track_operational_excellence'
   AND (SELECT "topicId" || '/' || "badgeLevel" FROM certifications WHERE id = 'cert1') = 'module_m1/PROFICIENT' AS ok;

-- nothing else was lost: the seeded chapters, answers, completions, files, the open attempt
SELECT (SELECT count(*) FROM chapters) = 7
   AND (SELECT count(*) FROM response_logs) = 1
   AND (SELECT count(*) FROM chapter_completions) = 1
   AND (SELECT count(*) FROM assets WHERE "chapterId" = 'c_kyc') = 1
   AND (SELECT "topicId" FROM test_sessions WHERE id = 's_open') = 'module_m2' AS ok,
       (SELECT count(*) FROM chapters) AS detail;

-- the one-open-attempt rule still holds under its new name
SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'test_sessions_one_open_topic_test_key') AS ok;
