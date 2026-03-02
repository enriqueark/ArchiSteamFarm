-- Optional hardening constraints for production.
-- Prisma currently does not model CHECK constraints directly, so keep this file
-- to enforce accounting invariants at the PostgreSQL level.

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

DO $$
BEGIN
  ALTER TABLE "wallets"
    ADD CONSTRAINT "wallets_locked_lte_balance"
    CHECK ("lockedAtomic" <= "balanceAtomic");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

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
  ALTER TABLE "wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_balances_non_negative"
    CHECK ("balanceBeforeAtomic" >= 0 AND "balanceAfterAtomic" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
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
