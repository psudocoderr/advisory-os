-- CreateEnum
CREATE TYPE "IntegrityEventKind" AS ENUM ('FULLSCREEN_EXIT', 'FULLSCREEN_ENTER', 'TAB_HIDDEN', 'WINDOW_BLUR', 'COPY', 'PASTE', 'CONTEXT_MENU');

-- CreateTable
CREATE TABLE "integrity_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" "IntegrityEventKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integrity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integrity_events_sessionId_occurredAt_idx" ON "integrity_events"("sessionId", "occurredAt");

-- AddForeignKey
ALTER TABLE "integrity_events" ADD CONSTRAINT "integrity_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "test_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

