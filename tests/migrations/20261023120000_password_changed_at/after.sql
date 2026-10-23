-- no existing account is asked to change its password
SELECT count(*) = 0 AS ok, count(*) AS detail FROM users WHERE "passwordChangedAt" IS NULL;

-- a row inserted without naming the column also gets a time, not null
WITH added AS (
  INSERT INTO users (id, email, name, "passwordHash", role, "updatedAt")
  VALUES ('u_later', 'later@test.local', 'Later', 'x', 'ADVISOR', now())
  RETURNING "passwordChangedAt"
)
SELECT "passwordChangedAt" IS NOT NULL AS ok, "passwordChangedAt" AS detail FROM added;
