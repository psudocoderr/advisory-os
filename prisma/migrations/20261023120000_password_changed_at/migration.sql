-- When each user last set their own password; null = set by an admin and to
-- be replaced at the next sign-in. Additive: adding the column with a default
-- fills every existing row with the time of the migration, so no current
-- account is asked to change its password and no session is ended.
ALTER TABLE "users" ADD COLUMN "passwordChangedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
