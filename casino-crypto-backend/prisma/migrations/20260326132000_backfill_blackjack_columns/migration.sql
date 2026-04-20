-- Backfill legacy blackjack table shape in already-running environments.
-- This migration is intentionally idempotent to recover from partial deploy states.

ALTER TABLE IF EXISTS "blackjack_games"
  ADD COLUMN IF NOT EXISTS "serverSeedId" TEXT;

ALTER TABLE IF EXISTS "blackjack_games"
  ADD COLUMN IF NOT EXISTS "serverSeedHash" TEXT;

ALTER TABLE IF EXISTS "blackjack_games"
  ADD COLUMN IF NOT EXISTS "clientSeed" TEXT;

ALTER TABLE IF EXISTS "blackjack_games"
  ADD COLUMN IF NOT EXISTS "nonce" INTEGER;

ALTER TABLE IF EXISTS "blackjack_games"
  ADD COLUMN IF NOT EXISTS "paytable" JSONB;

CREATE INDEX IF NOT EXISTS "blackjack_games_serverSeedId_idx"
  ON "blackjack_games"("serverSeedId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'blackjack_games_serverSeedId_fkey'
  ) THEN
    ALTER TABLE "blackjack_games"
      ADD CONSTRAINT "blackjack_games_serverSeedId_fkey"
      FOREIGN KEY ("serverSeedId")
      REFERENCES "provably_fair_seeds"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
