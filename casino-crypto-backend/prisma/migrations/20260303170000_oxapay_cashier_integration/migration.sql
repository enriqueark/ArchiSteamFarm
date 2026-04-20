-- OxaPay cashier integration (idempotent and safe for partially-applied states):
-- - Add SOL currency support.
-- - Create/extend payment_addresses storage.
-- - Track provider identifiers + source asset data for deposits/withdrawals.

ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'SOL';

CREATE TABLE IF NOT EXISTS "payment_addresses" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'OXAPAY',
  "asset" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "networkLabel" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "providerTrackId" TEXT NOT NULL,
  "callbackUrl" TEXT,
  "qrCodeUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_addresses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_addresses_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "payment_addresses"
  ADD COLUMN IF NOT EXISTS "provider" TEXT,
  ADD COLUMN IF NOT EXISTS "asset" TEXT,
  ADD COLUMN IF NOT EXISTS "network" TEXT,
  ADD COLUMN IF NOT EXISTS "networkLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "providerTrackId" TEXT,
  ADD COLUMN IF NOT EXISTS "callbackUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "qrCodeUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

UPDATE "payment_addresses"
SET
  "provider" = COALESCE("provider", 'OXAPAY'),
  "createdAt" = COALESCE("createdAt", CURRENT_TIMESTAMP),
  "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP)
WHERE "provider" IS NULL OR "createdAt" IS NULL OR "updatedAt" IS NULL;

ALTER TABLE "deposits"
  ADD COLUMN IF NOT EXISTS "asset" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "providerTrackId" TEXT;

ALTER TABLE "withdrawals"
  ADD COLUMN IF NOT EXISTS "asset" TEXT,
  ADD COLUMN IF NOT EXISTS "providerTrackId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "payment_addresses_providerTrackId_key"
  ON "payment_addresses"("providerTrackId");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_addresses_userId_asset_network_key"
  ON "payment_addresses"("userId", "asset", "network");
CREATE INDEX IF NOT EXISTS "payment_addresses_userId_idx"
  ON "payment_addresses"("userId");

CREATE INDEX IF NOT EXISTS "deposits_providerTrackId_idx"
  ON "deposits"("providerTrackId");

CREATE UNIQUE INDEX IF NOT EXISTS "withdrawals_providerTrackId_key"
  ON "withdrawals"("providerTrackId");
