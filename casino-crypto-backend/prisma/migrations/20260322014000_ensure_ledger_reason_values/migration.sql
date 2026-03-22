-- Ensure legacy deployments have all ledger enum values used by game settlement.
ALTER TYPE "LedgerReason" ADD VALUE IF NOT EXISTS 'BET_HOLD';
ALTER TYPE "LedgerReason" ADD VALUE IF NOT EXISTS 'BET_RELEASE';
ALTER TYPE "LedgerReason" ADD VALUE IF NOT EXISTS 'BET_CAPTURE';
ALTER TYPE "LedgerReason" ADD VALUE IF NOT EXISTS 'BET_PAYOUT';
