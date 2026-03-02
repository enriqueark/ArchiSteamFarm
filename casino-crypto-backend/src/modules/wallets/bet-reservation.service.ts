import {
  BetReservation,
  BetReservationStatus,
  Currency,
  LedgerDirection,
  LedgerReason,
  Prisma
} from "@prisma/client";

import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";
import { enqueueAuditEvent } from "../../infrastructure/queue/audit-queue";
import { debitBalance } from "./service";

type WalletState = {
  walletId: string;
  balanceAtomic: bigint;
  lockedAtomic: bigint;
};

type ReservationResult = {
  reservation: BetReservation;
  wallet: WalletState;
};

type HoldFundsInput = {
  actorUserId: string;
  userId: string;
  currency: Currency;
  betReference: string;
  amountAtomic: bigint;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

type FinalizeReservationInput = {
  actorUserId: string;
  userId: string;
  currency: Currency;
  betReference: string;
  idempotencyKey: string;
};

const isUniqueViolation = (error: unknown): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const getWalletState = async (walletId: string): Promise<WalletState> => {
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { id: true, balanceAtomic: true, lockedAtomic: true }
  });

  if (!wallet) {
    throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
  }

  return {
    walletId: wallet.id,
    balanceAtomic: wallet.balanceAtomic,
    lockedAtomic: wallet.lockedAtomic
  };
};

const findExistingReservation = async (
  walletId: string,
  betReference: string,
  idempotencyKey: string
): Promise<BetReservation | null> => {
  const filters: Prisma.BetReservationWhereInput[] = [{ betReference }, { holdIdempotencyKey: idempotencyKey }];
  return prisma.betReservation.findFirst({
    where: {
      walletId,
      OR: filters
    }
  });
};

export const holdFundsForBet = async (input: HoldFundsInput): Promise<ReservationResult> => {
  if (input.amountAtomic <= 0n) {
    throw new AppError("amountAtomic must be greater than 0", 400, "INVALID_AMOUNT");
  }

  const wallet = await prisma.wallet.findUnique({
    where: {
      userId_currency: {
        userId: input.userId,
        currency: input.currency
      }
    },
    select: {
      id: true
    }
  });

  if (!wallet) {
    throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
  }

  const existing = await findExistingReservation(wallet.id, input.betReference, input.idempotencyKey);
  if (existing) {
    if (existing.status !== BetReservationStatus.HELD) {
      throw new AppError("Bet reservation already finalized", 409, "BET_RESERVATION_FINALIZED");
    }

    const walletState = await getWalletState(wallet.id);
    return { reservation: existing, wallet: walletState };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const updatedWallet = await debitBalance(tx, {
        userId: input.userId,
        currency: input.currency,
        amountAtomic: input.amountAtomic,
        lockAmountAtomic: input.amountAtomic
      });

      const holdEntry = await tx.ledgerEntry.create({
        data: {
          walletId: updatedWallet.walletId,
          direction: LedgerDirection.DEBIT,
          reason: LedgerReason.BET_HOLD,
          amountAtomic: input.amountAtomic,
          balanceBeforeAtomic: updatedWallet.balanceBeforeAtomic,
          balanceAfterAtomic: updatedWallet.balanceAtomic,
          idempotencyKey: input.idempotencyKey,
          referenceId: input.betReference,
          metadata: {
            ...input.metadata,
            operation: "BET_HOLD",
            lockedAfterAtomic: updatedWallet.lockedAtomic.toString()
          } as Prisma.InputJsonValue
        }
      });

      const reservation = await tx.betReservation.create({
        data: {
          userId: input.userId,
          walletId: updatedWallet.walletId,
          currency: input.currency,
          betReference: input.betReference,
          amountAtomic: input.amountAtomic,
          holdIdempotencyKey: input.idempotencyKey,
          holdTransactionId: holdEntry.id,
          metadata: input.metadata as Prisma.InputJsonValue | undefined
        }
      });

      await tx.outboxEvent.create({
        data: {
          type: "BET_FUNDS_HELD",
          payload: {
            actorUserId: input.actorUserId,
            userId: input.userId,
            walletId: updatedWallet.walletId,
            currency: input.currency,
            betReference: input.betReference,
            amountAtomic: input.amountAtomic.toString(),
            balanceAtomic: updatedWallet.balanceAtomic.toString(),
            lockedAtomic: updatedWallet.lockedAtomic.toString()
          }
        }
      });

      return {
        reservation,
        wallet: {
          walletId: updatedWallet.walletId,
          balanceAtomic: updatedWallet.balanceAtomic,
          lockedAtomic: updatedWallet.lockedAtomic
        }
      };
    });

    void enqueueAuditEvent({
      type: "BET_FUNDS_HELD",
      actorId: input.actorUserId,
      targetId: input.userId,
      metadata: {
        currency: input.currency,
        betReference: input.betReference,
        amountAtomic: input.amountAtomic.toString(),
        balanceAtomic: result.wallet.balanceAtomic.toString(),
        lockedAtomic: result.wallet.lockedAtomic.toString()
      }
    });

    return result;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const alreadyCreated = await findExistingReservation(wallet.id, input.betReference, input.idempotencyKey);
      if (alreadyCreated) {
        const walletState = await getWalletState(wallet.id);
        return { reservation: alreadyCreated, wallet: walletState };
      }
    }

    throw error;
  }
};

export const releaseHeldFunds = async (input: FinalizeReservationInput): Promise<ReservationResult> => {
  const reservation = await prisma.betReservation.findFirst({
    where: {
      userId: input.userId,
      currency: input.currency,
      betReference: input.betReference
    }
  });

  if (!reservation) {
    throw new AppError("Bet reservation not found", 404, "BET_RESERVATION_NOT_FOUND");
  }

  if (reservation.status === BetReservationStatus.RELEASED) {
    return {
      reservation,
      wallet: await getWalletState(reservation.walletId)
    };
  }

  if (reservation.status === BetReservationStatus.CAPTURED) {
    throw new AppError("Bet reservation already captured", 409, "BET_RESERVATION_CAPTURED");
  }

  const result = await prisma.$transaction(async (tx) => {
    const transition = await tx.betReservation.updateMany({
      where: {
        id: reservation.id,
        status: BetReservationStatus.HELD
      },
      data: {
        status: BetReservationStatus.RELEASED,
        releaseIdempotencyKey: input.idempotencyKey
      }
    });

    if (transition.count === 0) {
      const current = await tx.betReservation.findUnique({
        where: { id: reservation.id }
      });

      if (!current) {
        throw new AppError("Bet reservation not found", 404, "BET_RESERVATION_NOT_FOUND");
      }

      if (current.status === BetReservationStatus.RELEASED) {
        const currentWallet = await tx.wallet.findUnique({
          where: { id: current.walletId },
          select: { id: true, balanceAtomic: true, lockedAtomic: true }
        });

        if (!currentWallet) {
          throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
        }

        return {
          reservation: current,
          wallet: {
            walletId: currentWallet.id,
            balanceAtomic: currentWallet.balanceAtomic,
            lockedAtomic: currentWallet.lockedAtomic
          }
        };
      }

      throw new AppError("Bet reservation already captured", 409, "BET_RESERVATION_CAPTURED");
    }

    const updatedRows = await tx.$queryRaw<Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>>`
      UPDATE "wallets"
      SET "balanceAtomic" = "balanceAtomic" + ${reservation.amountAtomic},
          "lockedAtomic" = "lockedAtomic" - ${reservation.amountAtomic},
          "updatedAt" = NOW()
      WHERE "id" = ${reservation.walletId}
        AND "lockedAtomic" >= ${reservation.amountAtomic}
      RETURNING id, "balanceAtomic", "lockedAtomic"
    `;

    const updatedWallet = updatedRows[0];
    if (!updatedWallet) {
      throw new AppError("Wallet lock invariant violated", 409, "WALLET_LOCK_INVARIANT_VIOLATED");
    }

    const balanceBefore = updatedWallet.balanceAtomic - reservation.amountAtomic;
    const releaseEntry = await tx.ledgerEntry.create({
      data: {
        walletId: reservation.walletId,
        direction: LedgerDirection.CREDIT,
        reason: LedgerReason.BET_RELEASE,
        amountAtomic: reservation.amountAtomic,
        balanceBeforeAtomic: balanceBefore,
        balanceAfterAtomic: updatedWallet.balanceAtomic,
        idempotencyKey: input.idempotencyKey,
        referenceId: reservation.betReference,
        metadata: {
          operation: "BET_RELEASE",
          lockedAfterAtomic: updatedWallet.lockedAtomic.toString()
        } as Prisma.InputJsonValue
      }
    });

    const updatedReservation = await tx.betReservation.update({
      where: { id: reservation.id },
      data: {
        releaseTransactionId: releaseEntry.id,
        releasedAt: new Date()
      }
    });

    await tx.outboxEvent.create({
      data: {
        type: "BET_FUNDS_RELEASED",
        payload: {
          actorUserId: input.actorUserId,
          userId: input.userId,
          walletId: reservation.walletId,
          currency: reservation.currency,
          betReference: reservation.betReference,
          amountAtomic: reservation.amountAtomic.toString(),
          balanceAtomic: updatedWallet.balanceAtomic.toString(),
          lockedAtomic: updatedWallet.lockedAtomic.toString()
        }
      }
    });

    return {
      reservation: updatedReservation,
      wallet: {
        walletId: updatedWallet.id,
        balanceAtomic: updatedWallet.balanceAtomic,
        lockedAtomic: updatedWallet.lockedAtomic
      }
    };
  });

  void enqueueAuditEvent({
    type: "BET_FUNDS_RELEASED",
    actorId: input.actorUserId,
    targetId: input.userId,
    metadata: {
      currency: reservation.currency,
      betReference: reservation.betReference,
      amountAtomic: reservation.amountAtomic.toString(),
      balanceAtomic: result.wallet.balanceAtomic.toString(),
      lockedAtomic: result.wallet.lockedAtomic.toString()
    }
  });

  return result;
};

export const captureHeldFunds = async (input: FinalizeReservationInput): Promise<ReservationResult> => {
  const reservation = await prisma.betReservation.findFirst({
    where: {
      userId: input.userId,
      currency: input.currency,
      betReference: input.betReference
    }
  });

  if (!reservation) {
    throw new AppError("Bet reservation not found", 404, "BET_RESERVATION_NOT_FOUND");
  }

  if (reservation.status === BetReservationStatus.CAPTURED) {
    return {
      reservation,
      wallet: await getWalletState(reservation.walletId)
    };
  }

  if (reservation.status === BetReservationStatus.RELEASED) {
    throw new AppError("Bet reservation already released", 409, "BET_RESERVATION_RELEASED");
  }

  const result = await prisma.$transaction(async (tx) => {
    const transition = await tx.betReservation.updateMany({
      where: {
        id: reservation.id,
        status: BetReservationStatus.HELD
      },
      data: {
        status: BetReservationStatus.CAPTURED,
        captureIdempotencyKey: input.idempotencyKey
      }
    });

    if (transition.count === 0) {
      const current = await tx.betReservation.findUnique({
        where: { id: reservation.id }
      });

      if (!current) {
        throw new AppError("Bet reservation not found", 404, "BET_RESERVATION_NOT_FOUND");
      }

      if (current.status === BetReservationStatus.CAPTURED) {
        const currentWallet = await tx.wallet.findUnique({
          where: { id: current.walletId },
          select: { id: true, balanceAtomic: true, lockedAtomic: true }
        });

        if (!currentWallet) {
          throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
        }

        return {
          reservation: current,
          wallet: {
            walletId: currentWallet.id,
            balanceAtomic: currentWallet.balanceAtomic,
            lockedAtomic: currentWallet.lockedAtomic
          }
        };
      }

      throw new AppError("Bet reservation already released", 409, "BET_RESERVATION_RELEASED");
    }

    const updatedRows = await tx.$queryRaw<Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>>`
      UPDATE "wallets"
      SET "lockedAtomic" = "lockedAtomic" - ${reservation.amountAtomic},
          "updatedAt" = NOW()
      WHERE "id" = ${reservation.walletId}
        AND "lockedAtomic" >= ${reservation.amountAtomic}
      RETURNING id, "balanceAtomic", "lockedAtomic"
    `;

    const updatedWallet = updatedRows[0];
    if (!updatedWallet) {
      throw new AppError("Wallet lock invariant violated", 409, "WALLET_LOCK_INVARIANT_VIOLATED");
    }

    const captureEntry = await tx.ledgerEntry.create({
      data: {
        walletId: reservation.walletId,
        direction: LedgerDirection.DEBIT,
        reason: LedgerReason.BET_CAPTURE,
        amountAtomic: reservation.amountAtomic,
        balanceBeforeAtomic: updatedWallet.balanceAtomic,
        balanceAfterAtomic: updatedWallet.balanceAtomic,
        idempotencyKey: input.idempotencyKey,
        referenceId: reservation.betReference,
        metadata: {
          operation: "BET_CAPTURE",
          lockedAfterAtomic: updatedWallet.lockedAtomic.toString()
        } as Prisma.InputJsonValue
      }
    });

    const updatedReservation = await tx.betReservation.update({
      where: { id: reservation.id },
      data: {
        captureTransactionId: captureEntry.id,
        capturedAt: new Date()
      }
    });

    await tx.outboxEvent.create({
      data: {
        type: "BET_FUNDS_CAPTURED",
        payload: {
          actorUserId: input.actorUserId,
          userId: input.userId,
          walletId: reservation.walletId,
          currency: reservation.currency,
          betReference: reservation.betReference,
          amountAtomic: reservation.amountAtomic.toString(),
          balanceAtomic: updatedWallet.balanceAtomic.toString(),
          lockedAtomic: updatedWallet.lockedAtomic.toString()
        }
      }
    });

    return {
      reservation: updatedReservation,
      wallet: {
        walletId: updatedWallet.id,
        balanceAtomic: updatedWallet.balanceAtomic,
        lockedAtomic: updatedWallet.lockedAtomic
      }
    };
  });

  void enqueueAuditEvent({
    type: "BET_FUNDS_CAPTURED",
    actorId: input.actorUserId,
    targetId: input.userId,
    metadata: {
      currency: reservation.currency,
      betReference: reservation.betReference,
      amountAtomic: reservation.amountAtomic.toString(),
      balanceAtomic: result.wallet.balanceAtomic.toString(),
      lockedAtomic: result.wallet.lockedAtomic.toString()
    }
  });

  return result;
};
