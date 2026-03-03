import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import {
  BetReservationStatus,
  CasinoBetStatus,
  Currency,
  LedgerDirection,
  LedgerReason,
  PrismaClient
} from "@prisma/client";
import { Pool } from "pg";

type Severity = "CRITICAL" | "HIGH" | "MEDIUM";

type AuditIssue = {
  severity: Severity;
  code: string;
  walletId?: string;
  userId?: string;
  currency?: Currency;
  betId?: string;
  message: string;
  context?: Record<string, unknown>;
};

type WalletLite = {
  id: string;
  userId: string;
  currency: Currency;
  balanceAtomic: bigint;
  lockedAtomic: bigint;
};

type LedgerEntryLite = {
  id: string;
  walletId: string;
  chainIndex: bigint;
  direction: LedgerDirection;
  reason: LedgerReason;
  amountAtomic: bigint;
  balanceBeforeAtomic: bigint;
  balanceAfterAtomic: bigint;
  idempotencyKey: string;
};

type ChainCheckRow = {
  is_valid: boolean;
  broken_at_chain_index: bigint | null;
  broken_transaction_id: string | null;
  expected_hash: string | null;
  actual_hash: string | null;
};

type DuplicateSettlementRow = {
  betId: string;
  duplicateCount: bigint;
};

type DuplicateKeyRow = {
  duplicateKey: string;
  duplicateCount: bigint;
};

type InconsistentBetRow = {
  betId: string;
  status: string;
};

type PayoutMismatchRow = {
  betId: string;
  expectedPayout: bigint;
  ledgerPayout: bigint;
};

type Summary = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  walletsScanned: number;
  ledgerEntriesScanned: number;
  issuesBySeverity: Record<Severity, number>;
  totalIssues: number;
};

const DATABASE_URL = process.env["DATABASE_URL"];
const PAGE_SIZE = Number(process.env["AUDIT_PAGE_SIZE"] ?? "250");
const MAX_ISSUES = Number(process.env["AUDIT_MAX_ISSUES"] ?? "5000");

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
  log: ["warn", "error"]
});

const issues: AuditIssue[] = [];
let walletsScanned = 0;
let ledgerEntriesScanned = 0;

const addIssue = (issue: AuditIssue): void => {
  if (issues.length >= MAX_ISSUES) {
    return;
  }
  issues.push(issue);
};

const bigintJsonReplacer = (_key: string, value: unknown): unknown =>
  typeof value === "bigint" ? value.toString() : value;

const ensurePositiveInteger = (value: number, fallback: number): number => {
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    return fallback;
  }
  return value;
};

const buildExpectedLockedByState = async (): Promise<Map<string, bigint>> => {
  const result = new Map<string, bigint>();

  const pendingBets = await prisma.casinoBet.groupBy({
    by: ["walletId"],
    where: {
      status: CasinoBetStatus.PENDING
    },
    _sum: {
      amountAtomic: true
    }
  });

  for (const row of pendingBets) {
    result.set(row.walletId, row._sum.amountAtomic ?? 0n);
  }

  const heldReservations = await prisma.betReservation.groupBy({
    by: ["walletId"],
    where: {
      status: BetReservationStatus.HELD
    },
    _sum: {
      amountAtomic: true
    }
  });

  for (const row of heldReservations) {
    const current = result.get(row.walletId) ?? 0n;
    result.set(row.walletId, current + (row._sum.amountAtomic ?? 0n));
  }

  return result;
};

const verifyWalletChain = async (walletId: string): Promise<ChainCheckRow | null> => {
  try {
    const rows = await prisma.$queryRaw<ChainCheckRow[]>`SELECT * FROM verify_wallet_transaction_chain(${walletId})`;
    return rows[0] ?? null;
  } catch {
    addIssue({
      severity: "HIGH",
      code: "LEDGER_CHAIN_VERIFICATION_FUNCTION_MISSING",
      walletId,
      message: "verify_wallet_transaction_chain function is unavailable. Ensure migration is applied."
    });
    return null;
  }
};

const auditWallet = async (wallet: WalletLite, expectedLockedByState: Map<string, bigint>): Promise<void> => {
  walletsScanned += 1;

  if (wallet.balanceAtomic < 0n) {
    addIssue({
      severity: "CRITICAL",
      code: "NEGATIVE_WALLET_BALANCE",
      walletId: wallet.id,
      userId: wallet.userId,
      currency: wallet.currency,
      message: "wallet.balanceAtomic is negative",
      context: { balanceAtomic: wallet.balanceAtomic }
    });
  }

  if (wallet.lockedAtomic < 0n) {
    addIssue({
      severity: "CRITICAL",
      code: "NEGATIVE_WALLET_LOCKED",
      walletId: wallet.id,
      userId: wallet.userId,
      currency: wallet.currency,
      message: "wallet.lockedAtomic is negative",
      context: { lockedAtomic: wallet.lockedAtomic }
    });
  }

  const totalFunds = wallet.balanceAtomic + wallet.lockedAtomic;
  if (wallet.lockedAtomic > totalFunds) {
    addIssue({
      severity: "CRITICAL",
      code: "LOCKED_EXCEEDS_TOTAL_FUNDS",
      walletId: wallet.id,
      userId: wallet.userId,
      currency: wallet.currency,
      message: "wallet.lockedAtomic exceeds total funds (balance + locked)",
      context: {
        balanceAtomic: wallet.balanceAtomic,
        lockedAtomic: wallet.lockedAtomic,
        totalFunds
      }
    });
  }

  const entries = await prisma.ledgerEntry.findMany({
    where: {
      walletId: wallet.id
    },
    orderBy: [{ chainIndex: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      walletId: true,
      chainIndex: true,
      direction: true,
      reason: true,
      amountAtomic: true,
      balanceBeforeAtomic: true,
      balanceAfterAtomic: true,
      idempotencyKey: true
    }
  });

  ledgerEntriesScanned += entries.length;

  let expectedLockedFromLedger = 0n;

  if (entries.length === 0) {
    if (wallet.balanceAtomic !== 0n) {
      addIssue({
        severity: "HIGH",
        code: "NON_ZERO_BALANCE_WITHOUT_LEDGER",
        walletId: wallet.id,
        userId: wallet.userId,
        currency: wallet.currency,
        message: "wallet has non-zero balance but no ledger entries",
        context: {
          walletBalanceAtomic: wallet.balanceAtomic
        }
      });
    }
  } else {
    let runningBalance = entries[0].balanceBeforeAtomic;

    for (let idx = 0; idx < entries.length; idx += 1) {
      const entry: LedgerEntryLite = entries[idx];
      const expectedChainIndex = BigInt(idx + 1);

      if (entry.chainIndex !== expectedChainIndex) {
        addIssue({
          severity: "HIGH",
          code: "LEDGER_CHAIN_INDEX_GAP",
          walletId: wallet.id,
          userId: wallet.userId,
          currency: wallet.currency,
          message: "ledger chainIndex sequence is not contiguous",
          context: {
            entryId: entry.id,
            expectedChainIndex,
            actualChainIndex: entry.chainIndex
          }
        });
      }

      if (entry.idempotencyKey.trim().length === 0) {
        addIssue({
          severity: "HIGH",
          code: "BLANK_LEDGER_IDEMPOTENCY_KEY",
          walletId: wallet.id,
          userId: wallet.userId,
          currency: wallet.currency,
          message: "ledger entry has blank idempotencyKey",
          context: {
            entryId: entry.id
          }
        });
      }

      if (entry.balanceBeforeAtomic !== runningBalance) {
        addIssue({
          severity: "CRITICAL",
          code: "LEDGER_BALANCE_BEFORE_MISMATCH",
          walletId: wallet.id,
          userId: wallet.userId,
          currency: wallet.currency,
          message: "ledger balanceBeforeAtomic does not match running balance",
          context: {
            entryId: entry.id,
            expectedBalanceBefore: runningBalance,
            actualBalanceBefore: entry.balanceBeforeAtomic
          }
        });
      }

      const delta = entry.direction === LedgerDirection.CREDIT ? entry.amountAtomic : -entry.amountAtomic;
      const expectedAfter = runningBalance + delta;

      if (entry.balanceAfterAtomic !== expectedAfter) {
        addIssue({
          severity: "CRITICAL",
          code: "LEDGER_BALANCE_AFTER_MISMATCH",
          walletId: wallet.id,
          userId: wallet.userId,
          currency: wallet.currency,
          message: "ledger balanceAfterAtomic does not match expected value",
          context: {
            entryId: entry.id,
            expectedBalanceAfter: expectedAfter,
            actualBalanceAfter: entry.balanceAfterAtomic
          }
        });
      }

      if (entry.balanceBeforeAtomic < 0n || entry.balanceAfterAtomic < 0n) {
        addIssue({
          severity: "CRITICAL",
          code: "NEGATIVE_LEDGER_RUNNING_BALANCE",
          walletId: wallet.id,
          userId: wallet.userId,
          currency: wallet.currency,
          message: "ledger entry contains negative before/after balance",
          context: {
            entryId: entry.id,
            balanceBeforeAtomic: entry.balanceBeforeAtomic,
            balanceAfterAtomic: entry.balanceAfterAtomic
          }
        });
      }

      if (entry.reason === LedgerReason.BET_HOLD) {
        expectedLockedFromLedger += entry.amountAtomic;
      } else if (entry.reason === LedgerReason.BET_RELEASE || entry.reason === LedgerReason.BET_CAPTURE) {
        expectedLockedFromLedger -= entry.amountAtomic;
      }

      runningBalance = entry.balanceAfterAtomic;
    }

    if (runningBalance !== wallet.balanceAtomic) {
      addIssue({
        severity: "CRITICAL",
        code: "WALLET_BALANCE_MISMATCH_WITH_LEDGER",
        walletId: wallet.id,
        userId: wallet.userId,
        currency: wallet.currency,
        message: "wallet.balanceAtomic does not match recomputed ledger balance",
        context: {
          walletBalanceAtomic: wallet.balanceAtomic,
          recomputedBalanceAtomic: runningBalance
        }
      });
    }
  }

  if (expectedLockedFromLedger < 0n) {
    addIssue({
      severity: "CRITICAL",
      code: "NEGATIVE_RECOMPUTED_LOCKED",
      walletId: wallet.id,
      userId: wallet.userId,
      currency: wallet.currency,
      message: "recomputed locked amount from ledger is negative",
      context: {
        recomputedLockedAtomic: expectedLockedFromLedger
      }
    });
  }

  if (expectedLockedFromLedger !== wallet.lockedAtomic) {
    addIssue({
      severity: "CRITICAL",
      code: "WALLET_LOCKED_MISMATCH_WITH_LEDGER",
      walletId: wallet.id,
      userId: wallet.userId,
      currency: wallet.currency,
      message: "wallet.lockedAtomic does not match recomputed locked amount from ledger",
      context: {
        walletLockedAtomic: wallet.lockedAtomic,
        recomputedLockedAtomic: expectedLockedFromLedger
      }
    });
  }

  const expectedFromState = expectedLockedByState.get(wallet.id) ?? 0n;
  if (expectedFromState !== wallet.lockedAtomic) {
    addIssue({
      severity: "HIGH",
      code: "WALLET_LOCKED_MISMATCH_WITH_BET_STATE",
      walletId: wallet.id,
      userId: wallet.userId,
      currency: wallet.currency,
      message: "wallet.lockedAtomic does not match locks implied by PENDING bets + HELD reservations",
      context: {
        walletLockedAtomic: wallet.lockedAtomic,
        expectedLockedFromStateAtomic: expectedFromState
      }
    });
  }

  const chainCheck = await verifyWalletChain(wallet.id);
  if (chainCheck && !chainCheck.is_valid) {
    addIssue({
      severity: "CRITICAL",
      code: "BROKEN_LEDGER_HASH_CHAIN",
      walletId: wallet.id,
      userId: wallet.userId,
      currency: wallet.currency,
      message: "wallet ledger hash chain verification failed",
      context: {
        brokenAtChainIndex: chainCheck.broken_at_chain_index,
        brokenTransactionId: chainCheck.broken_transaction_id,
        expectedHash: chainCheck.expected_hash,
        actualHash: chainCheck.actual_hash
      }
    });
  }
};

const auditDuplicateSettlements = async (): Promise<void> => {
  const duplicateCaptures = await prisma.$queryRaw<DuplicateSettlementRow[]>`
    SELECT "referenceId" AS "betId", COUNT(*)::bigint AS "duplicateCount"
    FROM "wallet_transactions"
    WHERE "reason" = ${LedgerReason.BET_CAPTURE}
      AND "referenceId" IS NOT NULL
    GROUP BY "referenceId"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `;

  for (const row of duplicateCaptures) {
    addIssue({
      severity: "CRITICAL",
      code: "DUPLICATE_SETTLEMENT_CAPTURE_LEDGER",
      betId: row.betId,
      message: "Multiple BET_CAPTURE ledger entries found for same bet",
      context: { duplicateCount: row.duplicateCount }
    });
  }

  const duplicatePayouts = await prisma.$queryRaw<DuplicateSettlementRow[]>`
    SELECT "referenceId" AS "betId", COUNT(*)::bigint AS "duplicateCount"
    FROM "wallet_transactions"
    WHERE "reason" = ${LedgerReason.BET_PAYOUT}
      AND "referenceId" IS NOT NULL
    GROUP BY "referenceId"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `;

  for (const row of duplicatePayouts) {
    addIssue({
      severity: "CRITICAL",
      code: "DUPLICATE_SETTLEMENT_PAYOUT_LEDGER",
      betId: row.betId,
      message: "Multiple BET_PAYOUT ledger entries found for same bet",
      context: { duplicateCount: row.duplicateCount }
    });
  }

  const duplicateSettleKeys = await prisma.$queryRaw<DuplicateKeyRow[]>`
    SELECT "settleIdempotencyKey" AS "duplicateKey", COUNT(*)::bigint AS "duplicateCount"
    FROM "casino_bets"
    WHERE "settleIdempotencyKey" IS NOT NULL
    GROUP BY "settleIdempotencyKey"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `;

  for (const row of duplicateSettleKeys) {
    addIssue({
      severity: "CRITICAL",
      code: "DUPLICATE_SETTLE_IDEMPOTENCY_KEY",
      message: "Duplicate casino_bets.settleIdempotencyKey detected",
      context: {
        duplicateKey: row.duplicateKey,
        duplicateCount: row.duplicateCount
      }
    });
  }

  const duplicateDecisionNonces = await prisma.$queryRaw<DuplicateKeyRow[]>`
    SELECT "decisionNonce" AS "duplicateKey", COUNT(*)::bigint AS "duplicateCount"
    FROM "bet_game_results"
    GROUP BY "decisionNonce"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `;

  for (const row of duplicateDecisionNonces) {
    addIssue({
      severity: "CRITICAL",
      code: "DUPLICATE_DECISION_NONCE",
      message: "Duplicate bet_game_results.decisionNonce detected",
      context: {
        duplicateKey: row.duplicateKey,
        duplicateCount: row.duplicateCount
      }
    });
  }

  const inconsistentSettled = await prisma.$queryRaw<InconsistentBetRow[]>`
    SELECT id AS "betId", "status"
    FROM "casino_bets"
    WHERE "status" IN ('WON', 'LOST')
      AND (
        "settledAt" IS NULL
        OR "captureTransactionId" IS NULL
        OR "settleBalanceBeforeAtomic" IS NULL
        OR "settleBalanceAfterAtomic" IS NULL
        OR "settleLockedAfterAtomic" IS NULL
      )
  `;

  for (const row of inconsistentSettled) {
    addIssue({
      severity: "CRITICAL",
      code: "PARTIAL_SETTLED_BET_STATE",
      betId: row.betId,
      message: "Settled casino bet has missing settlement fields",
      context: {
        status: row.status
      }
    });
  }

  const inconsistentPending = await prisma.$queryRaw<InconsistentBetRow[]>`
    SELECT id AS "betId", "status"
    FROM "casino_bets"
    WHERE "status" = 'PENDING'
      AND (
        "settledAt" IS NOT NULL
        OR "captureTransactionId" IS NOT NULL
        OR "payoutTransactionId" IS NOT NULL
      )
  `;

  for (const row of inconsistentPending) {
    addIssue({
      severity: "CRITICAL",
      code: "PARTIAL_PENDING_BET_STATE",
      betId: row.betId,
      message: "Pending casino bet contains settlement artifacts",
      context: {
        status: row.status
      }
    });
  }

  const payoutMismatches = await prisma.$queryRaw<PayoutMismatchRow[]>`
    SELECT
      b.id AS "betId",
      COALESCE(b."payoutAtomic", 0)::bigint AS "expectedPayout",
      COALESCE(SUM(wt."amountAtomic"), 0)::bigint AS "ledgerPayout"
    FROM "casino_bets" b
    LEFT JOIN "wallet_transactions" wt
      ON wt."referenceId" = b.id
     AND wt."reason" = ${LedgerReason.BET_PAYOUT}
    WHERE b."status" IN ('WON', 'LOST')
    GROUP BY b.id, b."payoutAtomic"
    HAVING COALESCE(b."payoutAtomic", 0) <> COALESCE(SUM(wt."amountAtomic"), 0)
  `;

  for (const row of payoutMismatches) {
    addIssue({
      severity: "CRITICAL",
      code: "PAYOUT_LEDGER_MISMATCH",
      betId: row.betId,
      message: "casino_bets.payoutAtomic mismatches total BET_PAYOUT ledger amount",
      context: {
        expectedPayoutAtomic: row.expectedPayout,
        ledgerPayoutAtomic: row.ledgerPayout
      }
    });
  }
};

const runAudit = async (): Promise<void> => {
  const startedAt = new Date();
  const pageSize = ensurePositiveInteger(PAGE_SIZE, 250);

  const expectedLockedByState = await buildExpectedLockedByState();

  let cursorId: string | null = null;
  while (true) {
    const wallets: WalletLite[] = await prisma.wallet.findMany({
      take: pageSize,
      ...(cursorId
        ? {
            cursor: {
              id: cursorId
            },
            skip: 1
          }
        : {}),
      orderBy: {
        id: "asc"
      },
      select: {
        id: true,
        userId: true,
        currency: true,
        balanceAtomic: true,
        lockedAtomic: true
      }
    });

    if (wallets.length === 0) {
      break;
    }

    for (const wallet of wallets) {
      await auditWallet(wallet, expectedLockedByState);
    }

    cursorId = wallets[wallets.length - 1]?.id ?? null;
    if (!cursorId) {
      break;
    }
  }

  await auditDuplicateSettlements();

  const issuesBySeverity: Record<Severity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0
  };

  for (const issue of issues) {
    issuesBySeverity[issue.severity] += 1;
  }

  const finishedAt = new Date();
  const summary: Summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    walletsScanned,
    ledgerEntriesScanned,
    issuesBySeverity,
    totalIssues: issues.length
  };

  const report = {
    ok: issues.length === 0,
    summary,
    issues
  };

  console.log(JSON.stringify(report, bigintJsonReplacer, 2));

  process.exitCode = issues.length === 0 ? 0 : 1;
};

void runAudit()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          fatal: true,
          message: error instanceof Error ? error.message : "Unknown audit error"
        },
        null,
        2
      )
    );
    process.exitCode = 2;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
