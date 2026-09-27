-- One active track certificate per user per track.
--
-- The existing unique (userId, moduleId, status) covers module badges but not
-- track certificates: their moduleId is NULL, and Postgres treats NULLs as
-- distinct, so two concurrent final-exam passes could each insert a row.
-- Partial, so revoked certificates and module badges are unaffected.
--
-- Prisma cannot express a partial index; schema.prisma documents it on the
-- Certification model, and `prisma migrate diff` ignores it (no drift).
--
-- Fails, and changes nothing, if duplicates already exist. None can in
-- practice yet (the final exam shipped in PR #22), but if it does fail:
-- revoke all but the best of each duplicate pair, then re-run.
CREATE UNIQUE INDEX "certifications_track_certificate_key"
  ON "certifications" ("userId", "trackId")
  WHERE "moduleId" IS NULL AND "status" = 'ACTIVE';
