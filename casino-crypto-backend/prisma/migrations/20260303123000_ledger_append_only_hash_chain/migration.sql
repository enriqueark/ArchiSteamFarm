-- Production migration: append-only tamper-evident ledger hardening
-- Goals:
-- 1) Add hash chain fields (previousHash/currentHash) per wallet ledger.
-- 2) Enforce immutable + append-only behavior for wallet_transactions.
-- 3) Add NOT NULL / format constraints for tamper-evidence.

SET lock_timeout = '5s';
SET statement_timeout = '10min';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Re-runnable safety: temporarily remove mutation guards while backfilling.
DROP TRIGGER IF EXISTS trg_wallet_transactions_prevent_update ON "wallet_transactions";
DROP TRIGGER IF EXISTS trg_wallet_transactions_prevent_delete ON "wallet_transactions";

-- 1) Add chain columns.
ALTER TABLE "wallet_transactions"
  ADD COLUMN IF NOT EXISTS "chainIndex" BIGINT,
  ADD COLUMN IF NOT EXISTS "previousHash" TEXT,
  ADD COLUMN IF NOT EXISTS "currentHash" TEXT;

-- 2) Harden idempotency key to always exist.
UPDATE "wallet_transactions"
SET "idempotencyKey" = CONCAT('legacy:', id)
WHERE "idempotencyKey" IS NULL;

-- 3) Canonical hash function for deterministic chain verification.
CREATE OR REPLACE FUNCTION wallet_transaction_chain_hash(
  p_wallet_id TEXT,
  p_chain_index BIGINT,
  p_previous_hash TEXT,
  p_direction TEXT,
  p_reason TEXT,
  p_amount_atomic BIGINT,
  p_balance_before_atomic BIGINT,
  p_balance_after_atomic BIGINT,
  p_idempotency_key TEXT,
  p_reference_id TEXT,
  p_created_at TIMESTAMP,
  p_metadata JSONB
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    digest(
      concat_ws(
        '|',
        p_wallet_id,
        p_chain_index::TEXT,
        p_previous_hash,
        p_direction,
        p_reason,
        p_amount_atomic::TEXT,
        p_balance_before_atomic::TEXT,
        p_balance_after_atomic::TEXT,
        COALESCE(p_idempotency_key, ''),
        COALESCE(p_reference_id, ''),
        p_created_at::TEXT,
        COALESCE(p_metadata::TEXT, 'null')
      ),
      'sha256'
    ),
    'hex'
  );
$$;

-- 4) Backfill chain for historical entries (ordered by createdAt, id) per wallet.
WITH RECURSIVE ordered AS (
  SELECT
    wt.id,
    wt."walletId",
    wt."direction"::TEXT AS direction_text,
    wt."reason"::TEXT AS reason_text,
    wt."amountAtomic",
    wt."balanceBeforeAtomic",
    wt."balanceAfterAtomic",
    wt."idempotencyKey",
    wt."referenceId",
    wt."createdAt",
    wt."metadata"::JSONB AS metadata_jsonb,
    ROW_NUMBER() OVER (PARTITION BY wt."walletId" ORDER BY wt."createdAt" ASC, wt.id ASC) AS rn
  FROM "wallet_transactions" wt
),
chain AS (
  SELECT
    o.id,
    o."walletId",
    o.rn AS chain_index,
    repeat('0', 64)::TEXT AS previous_hash,
    wallet_transaction_chain_hash(
      o."walletId",
      o.rn,
      repeat('0', 64)::TEXT,
      o.direction_text,
      o.reason_text,
      o."amountAtomic",
      o."balanceBeforeAtomic",
      o."balanceAfterAtomic",
      o."idempotencyKey",
      o."referenceId",
      o."createdAt",
      o.metadata_jsonb
    ) AS current_hash
  FROM ordered o
  WHERE o.rn = 1

  UNION ALL

  SELECT
    o.id,
    o."walletId",
    o.rn AS chain_index,
    c.current_hash AS previous_hash,
    wallet_transaction_chain_hash(
      o."walletId",
      o.rn,
      c.current_hash,
      o.direction_text,
      o.reason_text,
      o."amountAtomic",
      o."balanceBeforeAtomic",
      o."balanceAfterAtomic",
      o."idempotencyKey",
      o."referenceId",
      o."createdAt",
      o.metadata_jsonb
    ) AS current_hash
  FROM chain c
  JOIN ordered o
    ON o."walletId" = c."walletId"
   AND o.rn = c.chain_index + 1
)
UPDATE "wallet_transactions" wt
SET
  "chainIndex" = c.chain_index,
  "previousHash" = c.previous_hash,
  "currentHash" = c.current_hash
FROM chain c
WHERE wt.id = c.id;

-- 5) Defaults + NOT NULL guards.
ALTER TABLE "wallet_transactions"
  ALTER COLUMN "chainIndex" SET DEFAULT 0,
  ALTER COLUMN "previousHash" SET DEFAULT repeat('0', 64),
  ALTER COLUMN "currentHash" SET DEFAULT repeat('0', 64),
  ALTER COLUMN "idempotencyKey" SET NOT NULL,
  ALTER COLUMN "chainIndex" SET NOT NULL,
  ALTER COLUMN "previousHash" SET NOT NULL,
  ALTER COLUMN "currentHash" SET NOT NULL;

-- 6) Integrity constraints for append-only hash chain.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wallet_transactions_idempotency_not_blank_chk'
      AND conrelid = 'wallet_transactions'::regclass
  ) THEN
    ALTER TABLE "wallet_transactions"
      ADD CONSTRAINT "wallet_transactions_idempotency_not_blank_chk"
      CHECK (length(btrim("idempotencyKey")) > 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wallet_transactions_chain_index_positive_chk'
      AND conrelid = 'wallet_transactions'::regclass
  ) THEN
    ALTER TABLE "wallet_transactions"
      ADD CONSTRAINT "wallet_transactions_chain_index_positive_chk"
      CHECK ("chainIndex" > 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wallet_transactions_previous_hash_hex_chk'
      AND conrelid = 'wallet_transactions'::regclass
  ) THEN
    ALTER TABLE "wallet_transactions"
      ADD CONSTRAINT "wallet_transactions_previous_hash_hex_chk"
      CHECK ("previousHash" ~ '^[a-f0-9]{64}$') NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wallet_transactions_current_hash_hex_chk'
      AND conrelid = 'wallet_transactions'::regclass
  ) THEN
    ALTER TABLE "wallet_transactions"
      ADD CONSTRAINT "wallet_transactions_current_hash_hex_chk"
      CHECK ("currentHash" ~ '^[a-f0-9]{64}$') NOT VALID;
  END IF;
END $$;

ALTER TABLE "wallet_transactions" VALIDATE CONSTRAINT "wallet_transactions_idempotency_not_blank_chk";
ALTER TABLE "wallet_transactions" VALIDATE CONSTRAINT "wallet_transactions_chain_index_positive_chk";
ALTER TABLE "wallet_transactions" VALIDATE CONSTRAINT "wallet_transactions_previous_hash_hex_chk";
ALTER TABLE "wallet_transactions" VALIDATE CONSTRAINT "wallet_transactions_current_hash_hex_chk";

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_transactions_wallet_chain_idx_uniq"
  ON "wallet_transactions" ("walletId", "chainIndex");

CREATE INDEX IF NOT EXISTS "wallet_transactions_current_hash_idx"
  ON "wallet_transactions" ("currentHash");

-- 7) Trigger to compute hash chain atomically on insert.
CREATE OR REPLACE FUNCTION wallet_transactions_set_chain_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  last_chain_index BIGINT;
  last_hash TEXT;
BEGIN
  IF NEW."idempotencyKey" IS NULL OR length(btrim(NEW."idempotencyKey")) = 0 THEN
    RAISE EXCEPTION
      USING MESSAGE = 'wallet_transactions.idempotencyKey cannot be null/blank',
            ERRCODE = 'not_null_violation';
  END IF;

  IF NEW."createdAt" IS NULL THEN
    NEW."createdAt" := NOW();
  END IF;

  -- Serialize same-wallet chain advancement across concurrent inserts.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."walletId", 0));

  SELECT wt."chainIndex", wt."currentHash"
    INTO last_chain_index, last_hash
  FROM "wallet_transactions" wt
  WHERE wt."walletId" = NEW."walletId"
  ORDER BY wt."chainIndex" DESC
  LIMIT 1
  FOR UPDATE;

  NEW."chainIndex" := COALESCE(last_chain_index, 0) + 1;
  NEW."previousHash" := COALESCE(last_hash, repeat('0', 64));
  NEW."currentHash" := wallet_transaction_chain_hash(
    NEW."walletId",
    NEW."chainIndex",
    NEW."previousHash",
    NEW."direction"::TEXT,
    NEW."reason"::TEXT,
    NEW."amountAtomic",
    NEW."balanceBeforeAtomic",
    NEW."balanceAfterAtomic",
    NEW."idempotencyKey",
    NEW."referenceId",
    NEW."createdAt",
    NEW."metadata"::JSONB
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_transactions_set_chain_fields ON "wallet_transactions";

CREATE TRIGGER trg_wallet_transactions_set_chain_fields
BEFORE INSERT ON "wallet_transactions"
FOR EACH ROW
EXECUTE FUNCTION wallet_transactions_set_chain_fields();

-- 8) Immutable append-only guard: no UPDATE / DELETE after insertion.
CREATE OR REPLACE FUNCTION wallet_transactions_prevent_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    USING MESSAGE = 'wallet_transactions is append-only: updates/deletes are forbidden',
          ERRCODE = 'object_not_in_prerequisite_state';
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_transactions_prevent_update ON "wallet_transactions";
CREATE TRIGGER trg_wallet_transactions_prevent_update
BEFORE UPDATE ON "wallet_transactions"
FOR EACH ROW
EXECUTE FUNCTION wallet_transactions_prevent_mutation();

DROP TRIGGER IF EXISTS trg_wallet_transactions_prevent_delete ON "wallet_transactions";
CREATE TRIGGER trg_wallet_transactions_prevent_delete
BEFORE DELETE ON "wallet_transactions"
FOR EACH ROW
EXECUTE FUNCTION wallet_transactions_prevent_mutation();

-- 9) Chain verification function for periodic defensive audits.
CREATE OR REPLACE FUNCTION verify_wallet_transaction_chain(p_wallet_id TEXT)
RETURNS TABLE (
  is_valid BOOLEAN,
  broken_at_chain_index BIGINT,
  broken_transaction_id TEXT,
  expected_hash TEXT,
  actual_hash TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  previous_hash TEXT := repeat('0', 64);
  row_record RECORD;
  recomputed_hash TEXT;
BEGIN
  FOR row_record IN
    SELECT
      wt.id,
      wt."chainIndex",
      wt."previousHash",
      wt."currentHash",
      wt."walletId",
      wt."direction"::TEXT AS direction_text,
      wt."reason"::TEXT AS reason_text,
      wt."amountAtomic",
      wt."balanceBeforeAtomic",
      wt."balanceAfterAtomic",
      wt."idempotencyKey",
      wt."referenceId",
      wt."createdAt",
      wt."metadata"::JSONB AS metadata_jsonb
    FROM "wallet_transactions" wt
    WHERE wt."walletId" = p_wallet_id
    ORDER BY wt."chainIndex" ASC
  LOOP
    recomputed_hash := wallet_transaction_chain_hash(
      row_record."walletId",
      row_record."chainIndex",
      previous_hash,
      row_record.direction_text,
      row_record.reason_text,
      row_record."amountAtomic",
      row_record."balanceBeforeAtomic",
      row_record."balanceAfterAtomic",
      row_record."idempotencyKey",
      row_record."referenceId",
      row_record."createdAt",
      row_record.metadata_jsonb
    );

    IF row_record."previousHash" <> previous_hash
       OR row_record."currentHash" <> recomputed_hash THEN
      RETURN QUERY
      SELECT
        FALSE,
        row_record."chainIndex",
        row_record.id::TEXT,
        recomputed_hash,
        row_record."currentHash";
      RETURN;
    END IF;

    previous_hash := row_record."currentHash";
  END LOOP;

  RETURN QUERY
  SELECT
    TRUE,
    NULL::BIGINT,
    NULL::TEXT,
    NULL::TEXT,
    NULL::TEXT;
END;
$$;
