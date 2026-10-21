-- each attempt keeps the level it showed before the column existed
SELECT array_agg(id || ':' || coalesce("badgeLevel"::text, '-') ORDER BY id)
     = ARRAY['s_edge:EXPERT', 's_expert:EXPERT', 's_expert_band_65:PROFICIENT', 's_failed:-',
             's_old_rule:-', 's_proficient:PROFICIENT', 's_satisfactory:SATISFACTORY'] AS ok,
       array_agg(id || ':' || coalesce("badgeLevel"::text, '-') ORDER BY id) AS detail
FROM test_sessions;
