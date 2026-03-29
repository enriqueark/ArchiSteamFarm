ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "profileVisible" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "affiliate_codes" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "affiliate_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "referrals" (
  "id" TEXT NOT NULL,
  "referrerUserId" TEXT NOT NULL,
  "referredUserId" TEXT NOT NULL,
  "affiliateCodeId" TEXT NOT NULL,
  "bonusReceivedAtomic" BIGINT NOT NULL DEFAULT 0,
  "totalWageredAtomic" BIGINT NOT NULL DEFAULT 0,
  "totalCommissionAtomic" BIGINT NOT NULL DEFAULT 0,
  "claimableCommissionAtomic" BIGINT NOT NULL DEFAULT 0,
  "claimedCommissionAtomic" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "affiliate_commission_events" (
  "id" TEXT NOT NULL,
  "referralId" TEXT NOT NULL,
  "referrerUserId" TEXT NOT NULL,
  "referredUserId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "wagerAtomic" BIGINT NOT NULL,
  "commissionAtomic" BIGINT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_commission_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "affiliate_deposit_bonuses" (
  "id" TEXT NOT NULL,
  "referralId" TEXT NOT NULL,
  "referredUserId" TEXT NOT NULL,
  "depositId" TEXT NOT NULL,
  "bonusAtomic" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_deposit_bonuses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_codes_userId_key" ON "affiliate_codes"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_codes_code_key" ON "affiliate_codes"("code");
CREATE INDEX IF NOT EXISTS "affiliate_codes_code_idx" ON "affiliate_codes"("code");

CREATE UNIQUE INDEX IF NOT EXISTS "referrals_referredUserId_key" ON "referrals"("referredUserId");
CREATE INDEX IF NOT EXISTS "referrals_referrerUserId_createdAt_idx" ON "referrals"("referrerUserId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "referrals_affiliateCodeId_createdAt_idx" ON "referrals"("affiliateCodeId", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_commission_events_idempotencyKey_key"
ON "affiliate_commission_events"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "affiliate_commission_events_referrerUserId_createdAt_idx"
ON "affiliate_commission_events"("referrerUserId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "affiliate_commission_events_referredUserId_createdAt_idx"
ON "affiliate_commission_events"("referredUserId", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_deposit_bonuses_depositId_key"
ON "affiliate_deposit_bonuses"("depositId");
CREATE INDEX IF NOT EXISTS "affiliate_deposit_bonuses_referralId_createdAt_idx"
ON "affiliate_deposit_bonuses"("referralId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "affiliate_deposit_bonuses_referredUserId_createdAt_idx"
ON "affiliate_deposit_bonuses"("referredUserId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_codes_userId_fkey'
  ) THEN
    ALTER TABLE "affiliate_codes"
    ADD CONSTRAINT "affiliate_codes_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'referrals_referrerUserId_fkey'
  ) THEN
    ALTER TABLE "referrals"
    ADD CONSTRAINT "referrals_referrerUserId_fkey"
      FOREIGN KEY ("referrerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'referrals_referredUserId_fkey'
  ) THEN
    ALTER TABLE "referrals"
    ADD CONSTRAINT "referrals_referredUserId_fkey"
      FOREIGN KEY ("referredUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'referrals_affiliateCodeId_fkey'
  ) THEN
    ALTER TABLE "referrals"
    ADD CONSTRAINT "referrals_affiliateCodeId_fkey"
      FOREIGN KEY ("affiliateCodeId") REFERENCES "affiliate_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_commission_events_referralId_fkey'
  ) THEN
    ALTER TABLE "affiliate_commission_events"
    ADD CONSTRAINT "affiliate_commission_events_referralId_fkey"
      FOREIGN KEY ("referralId") REFERENCES "referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_commission_events_referrerUserId_fkey'
  ) THEN
    ALTER TABLE "affiliate_commission_events"
    ADD CONSTRAINT "affiliate_commission_events_referrerUserId_fkey"
      FOREIGN KEY ("referrerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_commission_events_referredUserId_fkey'
  ) THEN
    ALTER TABLE "affiliate_commission_events"
    ADD CONSTRAINT "affiliate_commission_events_referredUserId_fkey"
      FOREIGN KEY ("referredUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_deposit_bonuses_referralId_fkey'
  ) THEN
    ALTER TABLE "affiliate_deposit_bonuses"
    ADD CONSTRAINT "affiliate_deposit_bonuses_referralId_fkey"
      FOREIGN KEY ("referralId") REFERENCES "referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_deposit_bonuses_referredUserId_fkey'
  ) THEN
    ALTER TABLE "affiliate_deposit_bonuses"
    ADD CONSTRAINT "affiliate_deposit_bonuses_referredUserId_fkey"
      FOREIGN KEY ("referredUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_deposit_bonuses_depositId_fkey'
  ) THEN
    ALTER TABLE "affiliate_deposit_bonuses"
    ADD CONSTRAINT "affiliate_deposit_bonuses_depositId_fkey"
      FOREIGN KEY ("depositId") REFERENCES "deposits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
