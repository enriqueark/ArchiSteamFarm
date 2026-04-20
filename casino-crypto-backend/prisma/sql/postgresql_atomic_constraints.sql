-- Required financial integrity constraints.
-- Prisma currently does not model CHECK constraints directly, so this SQL must be
-- applied to enforce accounting invariants at the PostgreSQL level.

DO $$
BEGIN
  ALTER TABLE "wallets"
    ADD CONSTRAINT "wallets_balance_non_negative"
    CHECK ("balanceAtomic" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "wallets"
    ADD CONSTRAINT "wallets_locked_non_negative"
    CHECK ("lockedAtomic" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "casino_bets_single_final_state_idx"
  ON "casino_bets" ("id")
  WHERE "status" IN ('WON', 'LOST');

DO $$
BEGIN
  ALTER TABLE "wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_amount_positive"
    CHECK ("amountAtomic" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "bet_reservations"
    ADD CONSTRAINT "bet_reservations_amount_positive"
    CHECK ("amountAtomic" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "provably_fair_profiles"
    ADD CONSTRAINT "provably_fair_profiles_nonce_non_negative"
    CHECK ("nonce" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "mines_games"
    ADD CONSTRAINT "mines_games_mine_count_valid"
    CHECK ("mineCount" > 0 AND "mineCount" < "boardSize");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "mines_games"
    ADD CONSTRAINT "mines_games_safe_reveals_valid"
    CHECK ("safeReveals" >= 0 AND "safeReveals" <= ("boardSize" - "mineCount"));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "mines_games"
    ADD CONSTRAINT "mines_games_multiplier_valid"
    CHECK ("currentMultiplier" >= 1);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "roulette_rounds"
    ADD CONSTRAINT "roulette_rounds_winning_number_valid"
    CHECK ("winningNumber" IS NULL OR ("winningNumber" >= 0 AND "winningNumber" <= 36));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "roulette_rounds"
    ADD CONSTRAINT "roulette_rounds_total_staked_non_negative"
    CHECK ("totalStakedAtomic" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "roulette_rounds"
    ADD CONSTRAINT "roulette_rounds_total_payout_non_negative"
    CHECK ("totalPayoutAtomic" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "roulette_bets"
    ADD CONSTRAINT "roulette_bets_stake_positive"
    CHECK ("stakeAtomic" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "roulette_bets"
    ADD CONSTRAINT "roulette_bets_payout_non_negative"
    CHECK ("payoutAtomic" IS NULL OR "payoutAtomic" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "casino_bets"
    ADD CONSTRAINT "casino_bets_amount_positive"
    CHECK ("amountAtomic" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "casino_bets"
    ADD CONSTRAINT "casino_bets_payout_non_negative"
    CHECK ("payoutAtomic" IS NULL OR "payoutAtomic" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "casino_bets"
    ADD CONSTRAINT "casino_bets_multiplier_positive"
    CHECK ("multiplier" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "casino_bets"
    ADD CONSTRAINT "casino_bets_place_balances_non_negative"
    CHECK (
      "placeBalanceBeforeAtomic" >= 0
      AND "placeBalanceAfterAtomic" >= 0
      AND "placeLockedAfterAtomic" >= 0
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_balances_non_negative"
    CHECK ("balanceBeforeAtomic" >= 0 AND "balanceAfterAtomic" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_chain_index_positive"
    CHECK ("chainIndex" > 0);
EXCEPTION
  WHEN duplicate_object OR undefined_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_previous_hash_hex"
    CHECK ("previousHash" ~ '^[a-f0-9]{64}$');
EXCEPTION
  WHEN duplicate_object OR undefined_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_current_hash_hex"
    CHECK ("currentHash" ~ '^[a-f0-9]{64}$');
EXCEPTION
  WHEN duplicate_object OR undefined_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "deposits"
    ADD CONSTRAINT "deposits_amount_positive"
    CHECK ("amountAtomic" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "deposits"
    ADD CONSTRAINT "deposits_confirmations_valid"
    CHECK ("confirmations" >= 0 AND "requiredConfirmations" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "withdrawals"
    ADD CONSTRAINT "withdrawals_amount_positive"
    CHECK ("amountAtomic" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "withdrawals"
    ADD CONSTRAINT "withdrawals_fee_non_negative"
    CHECK ("feeAtomic" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
