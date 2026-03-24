-- OxaPay cashier integration:
-- - Extend existing payment_addresses table with provider callback metadata.
-- - Track provider identifiers for deposits and withdrawals.
-- - Add SOL currency support.

ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'SOL';

ALTER TABLE "payment_addresses"
  ADD COLUMN IF NOT EXISTS "callbackUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

ALTER TABLE "deposits"
  ADD COLUMN IF NOT EXISTS "providerTrackId" TEXT;

ALTER TABLE "withdrawals"
  ADD COLUMN IF NOT EXISTS "providerTrackId" TEXT;

CREATE INDEX IF NOT EXISTS "deposits_providerTrackId_idx"
  ON "deposits"("providerTrackId");

CREATE INDEX IF NOT EXISTS "withdrawals_providerTrackId_idx"
  ON "withdrawals"("providerTrackId");
