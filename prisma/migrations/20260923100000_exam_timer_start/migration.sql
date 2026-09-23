-- AlterTable
ALTER TABLE "test_sessions" ADD COLUMN "timerStartedAt" TIMESTAMP(3);

-- Sessions that already exist ran their clock from creation. Keep it that way,
-- so nobody mid-test when this deploys gains or loses time.
UPDATE "test_sessions" SET "timerStartedAt" = "startedAt";
