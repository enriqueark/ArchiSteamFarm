import { Currency, LedgerDirection, LedgerEntry, LedgerReason, Prisma } from "@prisma/client";

import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";
import { enqueueAuditEvent } from "../../infrastructure/queue/audit-queue";

type AdjustBalanceInput = {
  actorUserId: string;
  userId: string;
  currency: Currency;
  amountAtomic: bigint;
  reason: LedgerReason;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  referenceId?: string;
};

type AdjustBalanceResult = {
  entry: LedgerEntry;
  balanceAtomic: bigint;
};

const isUniqueViolation = (error: unknown): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export const adjustWalletBalance = async (input: AdjustBalanceInput): Promise<AdjustBalanceResult> => {
  if (input.amountAtomic === 0n) {
    throw new AppError("amountAtomic cannot be 0", 400, "INVALID_AMOUNT");
  }

  const result = await prisma.$transaction(async (tx) => {
    const walletRows = await tx.$queryRaw<Array<{ id: string; balanceAtomic: bigint }>>`
      SELECT id, "balanceAtomic"
      FROM "wallets"
      WHERE "userId" = ${input.userId}
        AND "currency" = ${input.currency}
      FOR UPDATE
    `;

    const wallet = walletRows[0];

    if (!wallet) {
      throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
    }

    if (input.idempotencyKey) {
      const existing = await tx.ledgerEntry.findUnique({
        where: {
          walletId_idempotencyKey: {
            walletId: wallet.id,
            idempotencyKey: input.idempotencyKey
          }
        }
      });

      if (existing) {
        return {
          entry: existing,
          balanceAtomic: existing.balanceAfterAtomic
        };
      }
    }

    const amountAbs = input.amountAtomic > 0n ? input.amountAtomic : -input.amountAtomic;
    const direction = input.amountAtomic > 0n ? LedgerDirection.CREDIT : LedgerDirection.DEBIT;
    const before = wallet.balanceAtomic;
    const after = direction === LedgerDirection.CREDIT ? before + amountAbs : before - amountAbs;

    if (after < 0n) {
      throw new AppError("Insufficient funds", 422, "INSUFFICIENT_FUNDS");
    }

    await tx.wallet.update({
      where: {
        id: wallet.id
      },
      data: {
        balanceAtomic: after
      }
    });

    let createdEntry: LedgerEntry;
    try {
      createdEntry = await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          direction,
          reason: input.reason,
          amountAtomic: amountAbs,
          balanceBeforeAtomic: before,
          balanceAfterAtomic: after,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
          referenceId: input.referenceId
        }
      });
    } catch (error) {
      if (isUniqueViolation(error) && input.idempotencyKey) {
        const existing = await tx.ledgerEntry.findUnique({
          where: {
            walletId_idempotencyKey: {
              walletId: wallet.id,
              idempotencyKey: input.idempotencyKey
            }
          }
        });

        if (existing) {
          return {
            entry: existing,
            balanceAtomic: existing.balanceAfterAtomic
          };
        }
      }

      throw error;
    }

    await tx.outboxEvent.create({
      data: {
        type: "WALLET_BALANCE_ADJUSTED",
        payload: {
          actorUserId: input.actorUserId,
          userId: input.userId,
          walletId: wallet.id,
          currency: input.currency,
          reason: input.reason,
          direction,
          amountAtomic: amountAbs.toString(),
          balanceAfterAtomic: after.toString(),
          referenceId: input.referenceId
        }
      }
    });

    return {
      entry: createdEntry,
      balanceAtomic: after
    };
  });

  void enqueueAuditEvent({
    type: "WALLET_BALANCE_ADJUSTED",
    actorId: input.actorUserId,
    targetId: input.userId,
    metadata: {
      currency: input.currency,
      reason: input.reason,
      amountAtomic: input.amountAtomic.toString(),
      balanceAfterAtomic: result.balanceAtomic.toString()
    }
  });

  return result;
};
