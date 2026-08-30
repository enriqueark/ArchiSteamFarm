ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "withdrawWagerRemainingAtomic" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "promo_codes" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "rewardAtomic" BIGINT NOT NULL,
  "usageLimit" INTEGER NOT NULL,
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "promo_code_redemptions" (
  "id" TEXT NOT NULL,
  "promoCodeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rewardAtomic" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "promo_code_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "affiliate_deposit_bonus_activations" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "affiliateCodeId" TEXT NOT NULL,
  "referrerUserId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "bonusBps" INTEGER NOT NULL DEFAULT 500,
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "affiliate_deposit_bonus_activations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "affiliate_deposit_bonus_credits" (
  "id" TEXT NOT NULL,
  "depositId" TEXT NOT NULL,
  "activationId" TEXT NOT NULL,
  "referredUserId" TEXT NOT NULL,
  "bonusAtomic" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_deposit_bonus_credits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "promo_codes_code_key" ON "promo_codes"("code");
CREATE INDEX IF NOT EXISTS "promo_codes_isActive_createdAt_idx"
ON "promo_codes"("isActive", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "promo_codes_createdAt_idx"
ON "promo_codes"("createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "promo_code_redemptions_promoCodeId_userId_key"
ON "promo_code_redemptions"("promoCodeId", "userId");
CREATE INDEX IF NOT EXISTS "promo_code_redemptions_userId_createdAt_idx"
ON "promo_code_redemptions"("userId", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_deposit_bonus_activations_userId_key"
ON "affiliate_deposit_bonus_activations"("userId");
CREATE INDEX IF NOT EXISTS "affiliate_deposit_bonus_activations_expiresAt_idx"
ON "affiliate_deposit_bonus_activations"("expiresAt");
CREATE INDEX IF NOT EXISTS "affiliate_deposit_bonus_activations_affiliateCodeId_expiresAt_idx"
ON "affiliate_deposit_bonus_activations"("affiliateCodeId", "expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_deposit_bonus_credits_depositId_key"
ON "affiliate_deposit_bonus_credits"("depositId");
CREATE INDEX IF NOT EXISTS "affiliate_deposit_bonus_credits_referredUserId_createdAt_idx"
ON "affiliate_deposit_bonus_credits"("referredUserId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'promo_codes_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "promo_codes"
    ADD CONSTRAINT "promo_codes_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'promo_code_redemptions_promoCodeId_fkey'
  ) THEN
    ALTER TABLE "promo_code_redemptions"
    ADD CONSTRAINT "promo_code_redemptions_promoCodeId_fkey"
      FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'promo_code_redemptions_userId_fkey'
  ) THEN
    ALTER TABLE "promo_code_redemptions"
    ADD CONSTRAINT "promo_code_redemptions_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_deposit_bonus_activations_userId_fkey'
  ) THEN
    ALTER TABLE "affiliate_deposit_bonus_activations"
    ADD CONSTRAINT "affiliate_deposit_bonus_activations_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_deposit_bonus_activations_affiliateCodeId_fkey'
  ) THEN
    ALTER TABLE "affiliate_deposit_bonus_activations"
    ADD CONSTRAINT "affiliate_deposit_bonus_activations_affiliateCodeId_fkey"
      FOREIGN KEY ("affiliateCodeId") REFERENCES "affiliate_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_deposit_bonus_activations_referrerUserId_fkey'
  ) THEN
    ALTER TABLE "affiliate_deposit_bonus_activations"
    ADD CONSTRAINT "affiliate_deposit_bonus_activations_referrerUserId_fkey"
      FOREIGN KEY ("referrerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_deposit_bonus_credits_activationId_fkey'
  ) THEN
    ALTER TABLE "affiliate_deposit_bonus_credits"
    ADD CONSTRAINT "affiliate_deposit_bonus_credits_activationId_fkey"
      FOREIGN KEY ("activationId") REFERENCES "affiliate_deposit_bonus_activations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_deposit_bonus_credits_referredUserId_fkey'
  ) THEN
    ALTER TABLE "affiliate_deposit_bonus_credits"
    ADD CONSTRAINT "affiliate_deposit_bonus_credits_referredUserId_fkey"
      FOREIGN KEY ("referredUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_deposit_bonus_credits_depositId_fkey'
  ) THEN
    ALTER TABLE "affiliate_deposit_bonus_credits"
    ADD CONSTRAINT "affiliate_deposit_bonus_credits_depositId_fkey"
      FOREIGN KEY ("depositId") REFERENCES "deposits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
