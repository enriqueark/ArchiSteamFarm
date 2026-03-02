import {
  CasinoBet,
  CasinoBetStatus,
  Currency,
  LedgerDirection,
  LedgerReason,
  Prisma
} from "@prisma/client";

import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";
import { enqueueAuditEvent } from "../../infrastructure/queue/audit-queue";

type PlaceBetInput = {
  userId: string;
  currency: Currency;
  gameType: string;
  roundReference: string;
  amountAtomic: bigint;
  placeIdempotencyKey: string;
};

type SettleBetInput = {
  userId: string;
  betId: string;
  result: "WON" | "LOST";
  payoutAtomic: bigint;
  settleIdempotencyKey: string;
};

export type PlaceBetResult = {
  betId: string;
  status: CasinoBetStatus;
  balanceBefore: bigint;
  balanceAfter: bigint;
  lockedAfter: bigint;
};

export type SettleBetResult = {
  betId: string;
  status: CasinoBetStatus;
  payoutAtomic: bigint;
  balanceBefore: bigint;
  balanceAfter: bigint;
  lockedAfter: bigint;
};

type LockedWalletRow = {
  id: string;
  balanceAtomic: bigint;
  lockedAtomic: bigint;
};

type LockedBetRow = {
  id: string;
};

const MAX_SERIALIZABLE_RETRIES = 4;

const isSerializationConflict = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";

const isUniqueViolation = (error: unknown): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const runSerializable = async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
    } catch (error) {
      lastError = error;

      if (!isSerializationConflict(error) || attempt === MAX_SERIALIZABLE_RETRIES) {
        break;
      }
    }
  }

  if (isSerializationConflict(lastError)) {
    throw new AppError(
      "Transaction conflict while processing bet. Please retry.",
      409,
      "TRANSACTION_CONFLICT"
    );
  }

  throw lastError;
};

const toPlaceResult = (
  bet: Pick<CasinoBet, "id" | "status">,
  balanceBefore: bigint,
  balanceAfter: bigint,
  lockedAfter: bigint
): PlaceBetResult => ({
  betId: bet.id,
  status: bet.status,
  balanceBefore,
  balanceAfter,
  lockedAfter
});

const toSettleResult = (
  bet: Pick<CasinoBet, "id" | "status">,
  payoutAtomic: bigint,
  balanceBefore: bigint,
  balanceAfter: bigint,
  lockedAfter: bigint
): SettleBetResult => ({
  betId: bet.id,
  status: bet.status,
  payoutAtomic,
  balanceBefore,
  balanceAfter,
  lockedAfter
});

const getWalletSnapshot = async (walletId: string): Promise<LockedWalletRow> => {
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: {
      id: true,
      balanceAtomic: true,
      lockedAtomic: true
    }
  });

  if (!wallet) {
    throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
  }

  return {
    id: wallet.id,
    balanceAtomic: wallet.balanceAtomic,
    lockedAtomic: wallet.lockedAtomic
  };
};

const getBetByPlaceKey = async (userId: string, placeIdempotencyKey: string) =>
  prisma.casinoBet.findUnique({
    where: {
      userId_placeIdempotencyKey: {
        userId,
        placeIdempotencyKey
      }
    }
  });

const getBetBySettleKey = async (settleIdempotencyKey: string) =>
  prisma.casinoBet.findUnique({
    where: {
      settleIdempotencyKey
    }
  });

export const placeBet = async (input: PlaceBetInput): Promise<PlaceBetResult> => {
  if (input.amountAtomic <= 0n) {
    throw new AppError("amountAtomic must be greater than 0", 400, "INVALID_AMOUNT");
  }

  if (!input.gameType.trim()) {
    throw new AppError("gameType is required", 400, "INVALID_GAME_TYPE");
  }

  if (!input.roundReference.trim()) {
    throw new AppError("roundReference is required", 400, "INVALID_ROUND_REFERENCE");
  }

  const existing = await getBetByPlaceKey(input.userId, input.placeIdempotencyKey);
  if (existing) {
    const wallet = await getWalletSnapshot(existing.walletId);
    const balanceBefore = wallet.balanceAtomic + existing.amountAtomic;

    return toPlaceResult(existing, balanceBefore, wallet.balanceAtomic, wallet.lockedAtomic);
  }

  try {
    const result = await runSerializable(async (tx) => {
      // Row lock guarantees that concurrent debits for the same wallet are serialized.
      const walletRows = await tx.$queryRaw<LockedWalletRow[]>`
        SELECT id, "balanceAtomic", "lockedAtomic"
        FROM "wallets"
        WHERE "userId" = ${input.userId}
          AND "currency" = ${input.currency}
        FOR UPDATE
      `;

      const wallet = walletRows[0];
      if (!wallet) {
        throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
      }

      if (wallet.balanceAtomic < input.amountAtomic) {
        throw new AppError("Insufficient funds", 422, "INSUFFICIENT_FUNDS");
      }

      const balanceBefore = wallet.balanceAtomic;
      const balanceAfter = wallet.balanceAtomic - input.amountAtomic;
      const lockedAfter = wallet.lockedAtomic + input.amountAtomic;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balanceAtomic: balanceAfter,
          lockedAtomic: lockedAfter
        }
      });

      const bet = await tx.casinoBet.create({
        data: {
          userId: input.userId,
          walletId: wallet.id,
          currency: input.currency,
          gameType: input.gameType.trim(),
          roundReference: input.roundReference.trim(),
          amountAtomic: input.amountAtomic,
          status: CasinoBetStatus.PENDING,
          placeIdempotencyKey: input.placeIdempotencyKey
        }
      });

      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          direction: LedgerDirection.DEBIT,
          reason: LedgerReason.BET_HOLD,
          amountAtomic: input.amountAtomic,
          balanceBeforeAtomic: balanceBefore,
          balanceAfterAtomic: balanceAfter,
          idempotencyKey: input.placeIdempotencyKey,
          referenceId: bet.id,
          metadata: {
            gameType: bet.gameType,
            roundReference: bet.roundReference,
            operation: "PLACE_BET_HOLD",
            lockedAfterAtomic: lockedAfter.toString()
          } as Prisma.InputJsonValue
        }
      });

      await tx.outboxEvent.create({
        data: {
          type: "CASINO_BET_PLACED",
          payload: {
            betId: bet.id,
            userId: input.userId,
            currency: input.currency,
            gameType: bet.gameType,
            roundReference: bet.roundReference,
            amountAtomic: input.amountAtomic.toString(),
            balanceBeforeAtomic: balanceBefore.toString(),
            balanceAfterAtomic: balanceAfter.toString(),
            lockedAfterAtomic: lockedAfter.toString()
          }
        }
      });

      return toPlaceResult(bet, balanceBefore, balanceAfter, lockedAfter);
    });

    void enqueueAuditEvent({
      type: "CASINO_BET_PLACED",
      actorId: input.userId,
      targetId: input.userId,
      metadata: {
        betId: result.betId,
        currency: input.currency,
        gameType: input.gameType,
        roundReference: input.roundReference,
        amountAtomic: input.amountAtomic.toString(),
        balanceBefore: result.balanceBefore.toString(),
        balanceAfter: result.balanceAfter.toString(),
        lockedAfter: result.lockedAfter.toString()
      }
    }).catch(() => undefined);

    return result;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const replay = await getBetByPlaceKey(input.userId, input.placeIdempotencyKey);
      if (replay) {
        const wallet = await getWalletSnapshot(replay.walletId);
        return toPlaceResult(
          replay,
          wallet.balanceAtomic + replay.amountAtomic,
          wallet.balanceAtomic,
          wallet.lockedAtomic
        );
      }
    }

    throw error;
  }
};

export const settleBet = async (input: SettleBetInput): Promise<SettleBetResult> => {
  if (input.payoutAtomic < 0n) {
    throw new AppError("payoutAtomic must be greater than or equal to 0", 400, "INVALID_PAYOUT");
  }

  if (input.result === "LOST" && input.payoutAtomic !== 0n) {
    throw new AppError("LOST bets must use payoutAtomic = 0", 400, "INVALID_PAYOUT_FOR_LOSS");
  }

  const settleReplay = await getBetBySettleKey(input.settleIdempotencyKey);
  if (settleReplay) {
    if (settleReplay.id !== input.betId || settleReplay.userId !== input.userId) {
      throw new AppError("Idempotency key already used for another settle operation", 409, "IDEMPOTENCY_KEY_REUSED");
    }

    const wallet = await getWalletSnapshot(settleReplay.walletId);
    const balanceBefore =
      settleReplay.status === CasinoBetStatus.WON ? wallet.balanceAtomic - settleReplay.payoutAtomic! : wallet.balanceAtomic;

    return toSettleResult(
      settleReplay,
      settleReplay.payoutAtomic ?? 0n,
      balanceBefore,
      wallet.balanceAtomic,
      wallet.lockedAtomic
    );
  }

  try {
    const result = await runSerializable(async (tx) => {
      // Lock the bet row first so only one resolver can transition PENDING -> FINAL.
      const betLockRows = await tx.$queryRaw<LockedBetRow[]>`
        SELECT id
        FROM "casino_bets"
        WHERE id = ${input.betId}
        FOR UPDATE
      `;

      if (!betLockRows[0]) {
        throw new AppError("Bet not found", 404, "BET_NOT_FOUND");
      }

      const bet = await tx.casinoBet.findUnique({
        where: {
          id: input.betId
        }
      });

      if (!bet) {
        throw new AppError("Bet not found", 404, "BET_NOT_FOUND");
      }

      if (bet.userId !== input.userId) {
        throw new AppError("Bet does not belong to the provided user", 403, "BET_USER_MISMATCH");
      }

      // Idempotent replay safety when retrying the exact same settle request.
      if (bet.status !== CasinoBetStatus.PENDING) {
        if (bet.settleIdempotencyKey === input.settleIdempotencyKey) {
          const walletReplay = await getWalletSnapshot(bet.walletId);
          const replayBefore =
            bet.status === CasinoBetStatus.WON ? walletReplay.balanceAtomic - (bet.payoutAtomic ?? 0n) : walletReplay.balanceAtomic;

          return toSettleResult(
            bet,
            bet.payoutAtomic ?? 0n,
            replayBefore,
            walletReplay.balanceAtomic,
            walletReplay.lockedAtomic
          );
        }

        throw new AppError("Bet is already settled", 409, "BET_ALREADY_SETTLED");
      }

      if (bet.amountAtomic <= 0n) {
        throw new AppError("Invalid bet amount persisted in database", 409, "BET_AMOUNT_INVALID");
      }

      // Lock wallet row to prevent concurrent settle / wallet writes from racing.
      const walletRows = await tx.$queryRaw<LockedWalletRow[]>`
        SELECT id, "balanceAtomic", "lockedAtomic"
        FROM "wallets"
        WHERE id = ${bet.walletId}
        FOR UPDATE
      `;

      const wallet = walletRows[0];
      if (!wallet) {
        throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
      }

      if (wallet.lockedAtomic < bet.amountAtomic) {
        throw new AppError("Wallet lock invariant violated", 409, "WALLET_LOCK_INVARIANT_VIOLATED");
      }

      let balanceBefore = wallet.balanceAtomic;
      let balanceAfter = wallet.balanceAtomic;
      const lockedAfter = wallet.lockedAtomic - bet.amountAtomic;

      const captureEntry = await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          direction: LedgerDirection.DEBIT,
          reason: LedgerReason.BET_CAPTURE,
          amountAtomic: bet.amountAtomic,
          balanceBeforeAtomic: wallet.balanceAtomic,
          balanceAfterAtomic: wallet.balanceAtomic,
          idempotencyKey: `${input.settleIdempotencyKey}:capture`,
          referenceId: bet.id,
          metadata: {
            gameType: bet.gameType,
            roundReference: bet.roundReference,
            operation: "SETTLE_BET_CAPTURE",
            lockedAfterAtomic: lockedAfter.toString()
          } as Prisma.InputJsonValue
        }
      });

      let payoutEntryId: string | null = null;
      if (input.result === "WON" && input.payoutAtomic > 0n) {
        balanceBefore = balanceAfter;
        balanceAfter = balanceAfter + input.payoutAtomic;

        const payoutEntry = await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            direction: LedgerDirection.CREDIT,
            reason: LedgerReason.BET_PAYOUT,
            amountAtomic: input.payoutAtomic,
            balanceBeforeAtomic: balanceBefore,
            balanceAfterAtomic: balanceAfter,
            idempotencyKey: `${input.settleIdempotencyKey}:payout`,
            referenceId: bet.id,
            metadata: {
              gameType: bet.gameType,
              roundReference: bet.roundReference,
              operation: "SETTLE_BET_PAYOUT",
              lockedAfterAtomic: lockedAfter.toString()
            } as Prisma.InputJsonValue
          }
        });

        payoutEntryId = payoutEntry.id;
      }

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balanceAtomic: balanceAfter,
          lockedAtomic: lockedAfter
        }
      });

      const settledBet = await tx.casinoBet.update({
        where: {
          id: bet.id
        },
        data: {
          status: input.result === "WON" ? CasinoBetStatus.WON : CasinoBetStatus.LOST,
          payoutAtomic: input.result === "WON" ? input.payoutAtomic : 0n,
          settleIdempotencyKey: input.settleIdempotencyKey,
          captureTransactionId: captureEntry.id,
          payoutTransactionId: payoutEntryId,
          settledAt: new Date()
        }
      });

      await tx.outboxEvent.create({
        data: {
          type: "CASINO_BET_SETTLED",
          payload: {
            betId: settledBet.id,
            userId: settledBet.userId,
            result: settledBet.status,
            payoutAtomic: (settledBet.payoutAtomic ?? 0n).toString(),
            balanceBeforeAtomic: wallet.balanceAtomic.toString(),
            balanceAfterAtomic: balanceAfter.toString(),
            lockedAfterAtomic: lockedAfter.toString()
          }
        }
      });

      return toSettleResult(
        settledBet,
        settledBet.payoutAtomic ?? 0n,
        wallet.balanceAtomic,
        balanceAfter,
        lockedAfter
      );
    });

    void enqueueAuditEvent({
      type: "CASINO_BET_SETTLED",
      actorId: input.userId,
      targetId: input.userId,
      metadata: {
        betId: result.betId,
        result: input.result,
        payoutAtomic: result.payoutAtomic.toString(),
        balanceBefore: result.balanceBefore.toString(),
        balanceAfter: result.balanceAfter.toString(),
        lockedAfter: result.lockedAfter.toString()
      }
    }).catch(() => undefined);

    return result;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const replay = await getBetBySettleKey(input.settleIdempotencyKey);
      if (replay && replay.id === input.betId && replay.userId === input.userId) {
        const wallet = await getWalletSnapshot(replay.walletId);
        return toSettleResult(
          replay,
          replay.payoutAtomic ?? 0n,
          replay.status === CasinoBetStatus.WON ? wallet.balanceAtomic - (replay.payoutAtomic ?? 0n) : wallet.balanceAtomic,
          wallet.balanceAtomic,
          wallet.lockedAtomic
        );
      }
    }

    throw error;
  }
};
