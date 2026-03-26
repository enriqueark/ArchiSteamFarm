-- Configurable blackjack side-bet payouts (house edge control)
CREATE TABLE IF NOT EXISTS "platform_configs" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_configs_pkey" PRIMARY KEY ("key")
);

INSERT INTO "platform_configs" ("key", "value")
VALUES (
  'BLACKJACK_SIDEBETS',
  '{"pairsMultiplier":"11.00","plus3Multiplier":"9.00"}'::jsonb
)
ON CONFLICT ("key") DO NOTHING;
