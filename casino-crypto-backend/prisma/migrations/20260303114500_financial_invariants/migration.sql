-- Production migration: financial invariants hardening
-- Scope: SQL-only; no application logic changes.

SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- 1) Wallet non-negative invariants
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wallets_balance_non_negative_chk'
      AND conrelid = 'wallets'::regclass
  ) THEN
    ALTER TABLE "wallets"
      ADD CONSTRAINT "wallets_balance_non_negative_chk"
      CHECK ("balanceAtomic" >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wallets_locked_non_negative_chk'
      AND conrelid = 'wallets'::regclass
  ) THEN
    ALTER TABLE "wallets"
      ADD CONSTRAINT "wallets_locked_non_negative_chk"
      CHECK ("lockedAtomic" >= 0) NOT VALID;
  END IF;
END $$;

-- "Total funds" in this wallet model are available + locked.
-- Enforce: lockedAtomic must never exceed total funds.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wallets_locked_lte_total_funds_chk'
      AND conrelid = 'wallets'::regclass
  ) THEN
    ALTER TABLE "wallets"
      ADD CONSTRAINT "wallets_locked_lte_total_funds_chk"
      CHECK ("lockedAtomic"::numeric <= ("balanceAtomic"::numeric + "lockedAtomic"::numeric)) NOT VALID;
  END IF;
END $$;

ALTER TABLE "wallets" VALIDATE CONSTRAINT "wallets_balance_non_negative_chk";
ALTER TABLE "wallets" VALIDATE CONSTRAINT "wallets_locked_non_negative_chk";
ALTER TABLE "wallets" VALIDATE CONSTRAINT "wallets_locked_lte_total_funds_chk";

-- 2) Idempotency uniqueness guarantees
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'casino_bets_settle_idempotency_key_uniq'
      AND conrelid = 'casino_bets'::regclass
  ) THEN
    ALTER TABLE "casino_bets"
      ADD CONSTRAINT "casino_bets_settle_idempotency_key_uniq"
      UNIQUE ("settleIdempotencyKey");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bet_game_results_decision_nonce_uniq'
      AND conrelid = 'bet_game_results'::regclass
  ) THEN
    ALTER TABLE "bet_game_results"
      ADD CONSTRAINT "bet_game_results_decision_nonce_uniq"
      UNIQUE ("decisionNonce");
  END IF;
END $$;

-- 3) Status transition guard:
--    prevent illegal regression from terminal states (WON/LOST) back to PENDING.
CREATE OR REPLACE FUNCTION prevent_casino_bet_status_regression_to_pending()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" IN ('WON', 'LOST')
     AND NEW."status" = 'PENDING' THEN
    RAISE EXCEPTION
      USING MESSAGE = 'Invalid status transition: terminal bet status cannot return to PENDING',
            ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_casino_bet_status_regression_to_pending ON "casino_bets";

CREATE TRIGGER trg_prevent_casino_bet_status_regression_to_pending
BEFORE UPDATE OF "status" ON "casino_bets"
FOR EACH ROW
EXECUTE FUNCTION prevent_casino_bet_status_regression_to_pending();

