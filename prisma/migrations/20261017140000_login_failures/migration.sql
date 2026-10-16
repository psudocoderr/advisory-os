-- Failed sign-ins, for login throttling (flags S3; src/lib/login-throttle.ts).
-- Additive only: a new table, nothing existing is touched. `key` holds a
-- SHA-256 of the email or client IP, never the value itself.

-- CreateTable
CREATE TABLE "login_failures" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_failures_key_createdAt_idx" ON "login_failures"("key", "createdAt");

-- CreateIndex
CREATE INDEX "login_failures_createdAt_idx" ON "login_failures"("createdAt");

