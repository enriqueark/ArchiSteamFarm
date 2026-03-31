-- User security flags and 2FA fields.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "twoFactorSecret" TEXT,
  ADD COLUMN IF NOT EXISTS "twoFactorTempSecret" TEXT,
  ADD COLUMN IF NOT EXISTS "canWithdraw" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "canTip" BOOLEAN NOT NULL DEFAULT true;

-- Battles fast mode toggle.
ALTER TABLE "battles"
  ADD COLUMN IF NOT EXISTS "modeFast" BOOLEAN NOT NULL DEFAULT false;

-- Currency conversion baseline for platform credits.
INSERT INTO "platform_configs" ("key", "value", "createdAt", "updatedAt")
VALUES (
  'platform.coinUsdRate',
  '{"coinUsdRate":0.7}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT ("key") DO UPDATE
SET
  "value" = EXCLUDED."value",
  "updatedAt" = NOW();

-- Extend ledger reason enum for vault/rain/tips operations.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'LedgerReason' AND e.enumlabel = 'VAULT_DEPOSIT'
  ) THEN
    ALTER TYPE "LedgerReason" ADD VALUE 'VAULT_DEPOSIT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'LedgerReason' AND e.enumlabel = 'VAULT_WITHDRAW'
  ) THEN
    ALTER TYPE "LedgerReason" ADD VALUE 'VAULT_WITHDRAW';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'LedgerReason' AND e.enumlabel = 'USER_TIP'
  ) THEN
    ALTER TYPE "LedgerReason" ADD VALUE 'USER_TIP';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'LedgerReason' AND e.enumlabel = 'RAIN_TIP'
  ) THEN
    ALTER TYPE "LedgerReason" ADD VALUE 'RAIN_TIP';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'LedgerReason' AND e.enumlabel = 'RAIN_PAYOUT'
  ) THEN
    ALTER TYPE "LedgerReason" ADD VALUE 'RAIN_PAYOUT';
  END IF;
END
$$;

-- Vault accounts and locks.
CREATE TABLE IF NOT EXISTS "vault_accounts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "balanceAtomic" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vault_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vault_accounts_userId_key" ON "vault_accounts"("userId");
CREATE INDEX IF NOT EXISTS "vault_accounts_updatedAt_idx" ON "vault_accounts"("updatedAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vault_accounts_userId_fkey'
  ) THEN
    ALTER TABLE "vault_accounts"
      ADD CONSTRAINT "vault_accounts_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "vault_locks" (
  "id" TEXT NOT NULL,
  "vaultId" TEXT NOT NULL,
  "amountAtomic" BIGINT NOT NULL,
  "unlockAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vault_locks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vault_locks_vaultId_unlockAt_idx" ON "vault_locks"("vaultId", "unlockAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vault_locks_vaultId_fkey'
  ) THEN
    ALTER TABLE "vault_locks"
      ADD CONSTRAINT "vault_locks_vaultId_fkey"
      FOREIGN KEY ("vaultId") REFERENCES "vault_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- Hourly rain rounds and participation/tips.
CREATE TABLE IF NOT EXISTS "rain_rounds" (
  "id" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "baseAmountAtomic" BIGINT NOT NULL DEFAULT 0,
  "tippedAmountAtomic" BIGINT NOT NULL DEFAULT 0,
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rain_rounds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rain_rounds_startsAt_endsAt_key" ON "rain_rounds"("startsAt", "endsAt");
CREATE INDEX IF NOT EXISTS "rain_rounds_endsAt_settledAt_idx" ON "rain_rounds"("endsAt", "settledAt");

CREATE TABLE IF NOT EXISTS "rain_joins" (
  "id" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rain_joins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rain_joins_roundId_userId_key" ON "rain_joins"("roundId", "userId");
CREATE INDEX IF NOT EXISTS "rain_joins_userId_createdAt_idx" ON "rain_joins"("userId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rain_joins_roundId_fkey'
  ) THEN
    ALTER TABLE "rain_joins"
      ADD CONSTRAINT "rain_joins_roundId_fkey"
      FOREIGN KEY ("roundId") REFERENCES "rain_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rain_joins_userId_fkey'
  ) THEN
    ALTER TABLE "rain_joins"
      ADD CONSTRAINT "rain_joins_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "rain_tips" (
  "id" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amountAtomic" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rain_tips_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "rain_tips_roundId_createdAt_idx" ON "rain_tips"("roundId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "rain_tips_userId_createdAt_idx" ON "rain_tips"("userId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rain_tips_roundId_fkey'
  ) THEN
    ALTER TABLE "rain_tips"
      ADD CONSTRAINT "rain_tips_roundId_fkey"
      FOREIGN KEY ("roundId") REFERENCES "rain_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rain_tips_userId_fkey'
  ) THEN
    ALTER TABLE "rain_tips"
      ADD CONSTRAINT "rain_tips_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- Direct user-to-user tips from chat.
CREATE TABLE IF NOT EXISTS "user_tips" (
  "id" TEXT NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "amountAtomic" BIGINT NOT NULL,
  "message" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_tips_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_tips_fromUserId_createdAt_idx" ON "user_tips"("fromUserId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "user_tips_toUserId_createdAt_idx" ON "user_tips"("toUserId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_tips_fromUserId_fkey'
  ) THEN
    ALTER TABLE "user_tips"
      ADD CONSTRAINT "user_tips_fromUserId_fkey"
      FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_tips_toUserId_fkey'
  ) THEN
    ALTER TABLE "user_tips"
      ADD CONSTRAINT "user_tips_toUserId_fkey"
      FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
