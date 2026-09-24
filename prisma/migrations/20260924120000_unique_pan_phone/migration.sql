-- PAN and mobile numbers become fixed-format and unique.
--
-- Mobile numbers move to E.164 ("+919876543210") so NRI/OCI clients with an
-- overseas number fit the same column. Every number stored before this is a
-- bare 10-digit Indian mobile, so those get +91 in front. Anything else is left
-- alone and will make the CHECK below fail loudly rather than be guessed at.
UPDATE "prospects" SET "phone" = '+91' || "phone" WHERE "phone" ~ '^[6-9][0-9]{9}$';
UPDATE "clients" SET "phone" = '+91' || "phone" WHERE "phone" ~ '^[6-9][0-9]{9}$';
UPDATE "clients" SET "pan" = upper(trim("pan"));

-- AlterTable
ALTER TABLE "prospects" ALTER COLUMN "phone" SET DATA TYPE VARCHAR(16);

-- AlterTable
ALTER TABLE "clients" ALTER COLUMN "phone" SET DATA TYPE VARCHAR(16),
ALTER COLUMN "pan" SET DATA TYPE CHAR(10);

-- CreateIndex
CREATE UNIQUE INDEX "prospects_phone_key" ON "prospects"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "clients_phone_key" ON "clients"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "clients_pan_key" ON "clients"("pan");

-- The same rules as src/lib/identifiers.ts, so a write that skips the app
-- (a script, the SQL editor) cannot store a malformed number either.
-- E.164: "+", a country code not starting with 0, at most 15 digits in all.
-- Indian (+91) numbers are exactly 10 digits starting 6-9.
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_phone_format"
  CHECK ("phone" ~ '^\+[1-9][0-9]{6,14}$' AND ("phone" !~ '^\+91' OR "phone" ~ '^\+91[6-9][0-9]{9}$'));

ALTER TABLE "clients" ADD CONSTRAINT "clients_phone_format"
  CHECK ("phone" ~ '^\+[1-9][0-9]{6,14}$' AND ("phone" !~ '^\+91' OR "phone" ~ '^\+91[6-9][0-9]{9}$'));

ALTER TABLE "clients" ADD CONSTRAINT "clients_pan_format"
  CHECK ("pan" ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');
