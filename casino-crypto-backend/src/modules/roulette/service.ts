import {
  Currency,
  LedgerDirection,
  LedgerReason,
  Prisma,
  RouletteBet,
  RouletteBetStatus,
  RouletteBetType,
  RouletteRound,
  RouletteRoundStatus
} from "@prisma/client";
import { randomInt, randomUUID } from "node:crypto";
import { FastifyBaseLogger } from "fastify";

import { env } from "../../config/env";
import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";
import { enqueueAuditEvent } from "../../infrastructure/queue/audit-queue";
import { PLATFORM_INTERNAL_CURRENCY, SUPPORTED_CURRENCIES, debitBalanceInTx } from "../wallets/service";
import {
  ROULETTE_MAX_NUMBER,
  ROULETTE_MIN_NUMBER,
  computePayoutAtomic,
  evaluateRouletteBet,
  getRouletteColor,
  validateRouletteBetInput
} from "./rules";
import { RouletteRealtimeEvent } from "./ws-hub";

type RoundTransitionRow = {
  id: string;
};

type WalletMutationRow = {
  id: string;
  balanceAtomic: bigint;
  lockedAtomic: bigint;
};

type ReservationSnapshot = {
  id: string;
  walletId: string;
  status: "HELD" | "RELEASED" | "CAPTURED";
};

type RouletteBetWithRelations = RouletteBet & {
  reservation: ReservationSnapshot;
  round: RouletteRound;
  user: {
    id: string;
    email: string;
  };
};

type RouletteBroadcaster = {
  broadcast: (event: RouletteRealtimeEvent) => void;
};

export type RouletteRoundState = {
  id: string;
  roundNumber: number;
  currency: Currency;
  status: RouletteRoundStatus;
  openAt: Date;
  betsCloseAt: Date;
  spinStartsAt: Date;
  settleAt: Date;
  winningNumber: number | null;
  winningColor: string | null;
  totalStakedAtomic: bigint;
  totalPayoutAtomic: bigint;
};

export type RouletteBetState = {
  id: string;
  roundId: string;
  userId: string;
  currency: Currency;
  betType: RouletteBetType;
  betValue: number | null;
  stakeAtomic: bigint;
  payoutAtomic: bigint | null;
  status: RouletteBetStatus;
  createdAt: Date;
  settledAt: Date | null;
};

export type RouletteBetPlacementResult = {
  round: RouletteRoundState;
  bet: RouletteBetState;
  wallet: {
    walletId: string;
    balanceAtomic: bigint;
    lockedAtomic: bigint;
  };
};

type BetBreakdownTotals = {
  RED: bigint;
  BLACK: bigint;
  GREEN: bigint;
  BAIT: bigint;
};

type BetBreakdownUserEntry = {
  userId: string;
  userLabel: string;
  stakeAtomic: bigint;
};

type BetBreakdownEntriesByType = {
  RED: BetBreakdownUserEntry[];
  BLACK: BetBreakdownUserEntry[];
  GREEN: BetBreakdownUserEntry[];
  BAIT: BetBreakdownUserEntry[];
};

export type RouletteBetBreakdownState = {
  roundId: string;
  roundNumber: number;
  currency: Currency;
  totalsAtomic: {
    RED: bigint;
    BLACK: bigint;
    GREEN: bigint;
    BAIT: bigint;
  };
  entriesByType: BetBreakdownEntriesByType;
  totalStakedAtomic: bigint;
};

export type RouletteSettlementOutcome = {
  userId: string;
  userLabel: string;
  netAtomic: bigint;
};

export type RouletteResultHistoryItem = {
  roundId: string;
  roundNumber: number;
  currency: Currency;
  winningNumber: number;
  winningColor: string;
  totalStakedAtomic: bigint;
  totalPayoutAtomic: bigint;
  settledAt: Date;
};

type PlaceRouletteBetInput = {
  userId: string;
  currency: Currency;
  stakeAtomic: bigint;
  betType: RouletteBetType;
  betValue?: number;
  idempotencyKey: string;
  roundId?: string;
};

const ROUND_OPEN_MS = env.ROULETTE_ROUND_OPEN_SECONDS * 1000;
// Security/business rule: spin starts exactly when betting window closes.
const ROUND_CLOSE_TO_SPIN_MS = 0;
const ROUND_SPIN_MS = env.ROULETTE_SPIN_SECONDS * 1000;
const WORKER_TICK_MS = env.ROULETTE_WORKER_TICK_MS;
const ROUND_RESULTS_PAUSE_MS = 5_000;

let broadcaster: RouletteBroadcaster | null = null;
let workerTimer: NodeJS.Timeout | null = null;
let workerProcessing = false;

const isUniqueViolation = (error: unknown): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const toRoundState = (round: RouletteRound): RouletteRoundState => ({
  id: round.id,
  roundNumber: round.roundNumber,
  currency: round.currency,
  status: round.status,
  openAt: round.openAt,
  betsCloseAt: round.betsCloseAt,
  spinStartsAt: round.spinStartsAt,
  settleAt: round.settleAt,
  winningNumber: round.winningNumber ?? null,
  winningColor: round.winningColor ?? null,
  totalStakedAtomic: round.totalStakedAtomic,
  totalPayoutAtomic: round.totalPayoutAtomic
});

const toBetState = (bet: RouletteBet): RouletteBetState => ({
  id: bet.id,
  roundId: bet.roundId,
  userId: bet.userId,
  currency: bet.currency,
  betType: bet.betType,
  betValue: bet.betValue ?? null,
  stakeAtomic: bet.stakeAtomic,
  payoutAtomic: bet.payoutAtomic ?? null,
  status: bet.status,
  createdAt: bet.createdAt,
  settledAt: bet.settledAt ?? null
});

const emitRoundEvent = (round: RouletteRound): void => {
  broadcaster?.broadcast({
    type: "roulette.round",
    data: {
      roundId: round.id,
      roundNumber: round.roundNumber,
      currency: round.currency,
      status: round.status,
      openAt: round.openAt.toISOString(),
      betsCloseAt: round.betsCloseAt.toISOString(),
      spinStartsAt: round.spinStartsAt.toISOString(),
      settleAt: round.settleAt.toISOString(),
      winningNumber: round.winningNumber ?? null,
      winningColor: round.winningColor ?? null,
      totalStakedAtomic: round.totalStakedAtomic.toString(),
      totalPayoutAtomic: round.totalPayoutAtomic.toString()
    }
  });
};

const emitTotalsEvent = (roundId: string, currency: Currency, totalStakedAtomic: bigint): void => {
  broadcaster?.broadcast({
    type: "roulette.betTotals",
    data: {
      roundId,
      currency,
      totalStakedAtomic: totalStakedAtomic.toString()
    }
  });
};

const emitBetBreakdownEvent = (state: RouletteBetBreakdownState): void => {
  broadcaster?.broadcast({
    type: "roulette.betBreakdown",
    data: {
      roundId: state.roundId,
      roundNumber: state.roundNumber,
      currency: state.currency,
      totalsAtomic: {
        RED: state.totalsAtomic.RED.toString(),
        BLACK: state.totalsAtomic.BLACK.toString(),
        GREEN: state.totalsAtomic.GREEN.toString(),
        BAIT: state.totalsAtomic.BAIT.toString()
      },
      entriesByType: {
        RED: state.entriesByType.RED.map((entry) => ({
          userId: entry.userId,
          userLabel: entry.userLabel,
          stakeAtomic: entry.stakeAtomic.toString()
        })),
        BLACK: state.entriesByType.BLACK.map((entry) => ({
          userId: entry.userId,
          userLabel: entry.userLabel,
          stakeAtomic: entry.stakeAtomic.toString()
        })),
        GREEN: state.entriesByType.GREEN.map((entry) => ({
          userId: entry.userId,
          userLabel: entry.userLabel,
          stakeAtomic: entry.stakeAtomic.toString()
        })),
        BAIT: state.entriesByType.BAIT.map((entry) => ({
          userId: entry.userId,
          userLabel: entry.userLabel,
          stakeAtomic: entry.stakeAtomic.toString()
        }))
      },
      totalStakedAtomic: state.totalStakedAtomic.toString()
    }
  });
};

const emitSettlementSummaryEvent = (payload: {
  roundId: string;
  roundNumber: number;
  currency: Currency;
  winningNumber: number;
  winningColor: string;
  outcomes: RouletteSettlementOutcome[];
}): void => {
  broadcaster?.broadcast({
    type: "roulette.settlementSummary",
    data: {
      roundId: payload.roundId,
      roundNumber: payload.roundNumber,
      currency: payload.currency,
      winningNumber: payload.winningNumber,
      winningColor: payload.winningColor,
      outcomes: payload.outcomes.map((entry) => ({
        userId: entry.userId,
        userLabel: entry.userLabel,
        netAtomic: entry.netAtomic.toString()
      }))
    }
  });
};

const getEmptyBetBreakdownTotals = (): BetBreakdownTotals => ({
  RED: 0n,
  BLACK: 0n,
  GREEN: 0n,
  BAIT: 0n
});

const getEmptyBetBreakdownEntriesByType = (): BetBreakdownEntriesByType => ({
  RED: [],
  BLACK: [],
  GREEN: [],
  BAIT: []
});

const formatUserLabel = (email: string, userId: string): string => {
  const local = email.split("@")[0]?.trim();
  if (local && local.length > 0) {
    return `Usuario ${local.slice(0, 18)}`;
  }

  return `Usuario ${userId.slice(0, 8)}`;
};

const createRoundForCurrencyTx = async (
  tx: Prisma.TransactionClient,
  currency: Currency,
  createdByUserId?: string
): Promise<RouletteRound> => {
  const latest = await tx.rouletteRound.findFirst({
    where: { currency },
    orderBy: { roundNumber: "desc" },
    select: { roundNumber: true }
  });

  const roundNumber = (latest?.roundNumber ?? 0) + 1;
  const openAt = new Date();
  const betsCloseAt = new Date(openAt.getTime() + ROUND_OPEN_MS);
  const spinStartsAt = new Date(betsCloseAt.getTime() + ROUND_CLOSE_TO_SPIN_MS);
  const settleAt = new Date(spinStartsAt.getTime() + ROUND_SPIN_MS);

  return tx.rouletteRound.create({
    data: {
      roundNumber,
      currency,
      status: RouletteRoundStatus.OPEN,
      openAt,
      betsCloseAt,
      spinStartsAt,
      settleAt,
      totalStakedAtomic: 0n,
      totalPayoutAtomic: 0n,
      createdByUserId
    }
  });
};

const findActiveRound = async (currency: Currency): Promise<RouletteRound | null> =>
  prisma.rouletteRound.findFirst({
    where: {
      currency,
      status: {
        in: [RouletteRoundStatus.OPEN, RouletteRoundStatus.CLOSED, RouletteRoundStatus.SPINNING]
      }
    },
    orderBy: {
      roundNumber: "desc"
    }
  });

const findLatestSettledRound = async (currency: Currency): Promise<RouletteRound | null> =>
  prisma.rouletteRound.findFirst({
    where: {
      currency,
      status: RouletteRoundStatus.SETTLED
    },
    orderBy: {
      settledAt: "desc"
    }
  });

const shouldWaitBeforeOpeningRound = async (currency: Currency): Promise<boolean> => {
  const latestSettled = await findLatestSettledRound(currency);
  if (!latestSettled?.settledAt) {
    return false;
  }

  return Date.now() - latestSettled.settledAt.getTime() < ROUND_RESULTS_PAUSE_MS;
};

const loadBetBreakdownByRoundId = async (
  roundId: string
): Promise<{ totals: BetBreakdownTotals; entriesByType: BetBreakdownEntriesByType }> => {
  const groupedByType = await prisma.rouletteBet.groupBy({
    by: ["betType"],
    where: {
      roundId,
      betType: {
        in: [RouletteBetType.RED, RouletteBetType.BLACK, RouletteBetType.GREEN, RouletteBetType.BAIT]
      }
    },
    _sum: {
      stakeAtomic: true
    }
  });

  const totals = getEmptyBetBreakdownTotals();
  for (const row of groupedByType) {
    if (row.betType === RouletteBetType.RED) {
      totals.RED = row._sum.stakeAtomic ?? 0n;
    } else if (row.betType === RouletteBetType.BLACK) {
      totals.BLACK = row._sum.stakeAtomic ?? 0n;
    } else if (row.betType === RouletteBetType.GREEN) {
      totals.GREEN = row._sum.stakeAtomic ?? 0n;
    } else if (row.betType === RouletteBetType.BAIT) {
      totals.BAIT = row._sum.stakeAtomic ?? 0n;
    }
  }

  const groupedByTypeAndUser = await prisma.rouletteBet.groupBy({
    by: ["betType", "userId"],
    where: {
      roundId,
      betType: {
        in: [RouletteBetType.RED, RouletteBetType.BLACK, RouletteBetType.GREEN, RouletteBetType.BAIT]
      }
    },
    _sum: {
      stakeAtomic: true
    }
  });

  const userIds = Array.from(new Set(groupedByTypeAndUser.map((row) => row.userId)));
  const users = userIds.length
    ? await prisma.user.findMany({
        where: {
          id: {
            in: userIds
          }
        },
        select: {
          id: true,
          email: true
        }
      })
    : [];

  const userEmailById = new Map(users.map((user) => [user.id, user.email]));
  const entriesByType = getEmptyBetBreakdownEntriesByType();
  for (const row of groupedByTypeAndUser) {
    const stakeAtomic = row._sum.stakeAtomic ?? 0n;
    if (stakeAtomic <= 0n) {
      continue;
    }

    const email = userEmailById.get(row.userId) ?? "";
    const entry: BetBreakdownUserEntry = {
      userId: row.userId,
      userLabel: formatUserLabel(email, row.userId),
      stakeAtomic
    };

    if (row.betType === RouletteBetType.RED) {
      entriesByType.RED.push(entry);
    } else if (row.betType === RouletteBetType.BLACK) {
      entriesByType.BLACK.push(entry);
    } else if (row.betType === RouletteBetType.GREEN) {
      entriesByType.GREEN.push(entry);
    } else if (row.betType === RouletteBetType.BAIT) {
      entriesByType.BAIT.push(entry);
    }
  }

  const sortEntries = (items: BetBreakdownUserEntry[]) =>
    items.sort((a, b) => {
      if (a.stakeAtomic === b.stakeAtomic) {
        return a.userId.localeCompare(b.userId);
      }
      return a.stakeAtomic > b.stakeAtomic ? -1 : 1;
    });

  sortEntries(entriesByType.RED);
  sortEntries(entriesByType.BLACK);
  sortEntries(entriesByType.GREEN);
  sortEntries(entriesByType.BAIT);

  return { totals, entriesByType };
};

const ensureOpenRoundForCurrency = async (currency: Currency): Promise<RouletteRound> => {
  const existingOpen = await prisma.rouletteRound.findFirst({
    where: {
      currency,
      status: RouletteRoundStatus.OPEN,
      betsCloseAt: {
        gt: new Date()
      }
    },
    orderBy: {
      roundNumber: "desc"
    }
  });

  if (existingOpen) {
    return existingOpen;
  }

  try {
    const created = await prisma.$transaction((tx) => createRoundForCurrencyTx(tx, currency));
    emitRoundEvent(created);
    emitBetBreakdownEvent({
      roundId: created.id,
      roundNumber: created.roundNumber,
      currency: created.currency,
      totalsAtomic: getEmptyBetBreakdownTotals(),
      entriesByType: getEmptyBetBreakdownEntriesByType(),
      totalStakedAtomic: created.totalStakedAtomic
    });
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const concurrent = await prisma.rouletteRound.findFirst({
        where: {
          currency,
          status: RouletteRoundStatus.OPEN
        },
        orderBy: {
          roundNumber: "desc"
        }
      });

      if (concurrent) {
        return concurrent;
      }
    }

    throw error;
  }
};

const getWalletSnapshot = async (walletId: string) => {
  const wallet = await prisma.wallet.findUnique({
    where: {
      id: walletId
    },
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
    walletId: wallet.id,
    balanceAtomic: wallet.balanceAtomic,
    lockedAtomic: wallet.lockedAtomic
  };
};

const captureReservationForRouletteBet = async (
  tx: Prisma.TransactionClient,
  bet: RouletteBetWithRelations,
  idempotencyKey: string
): Promise<{ walletId: string; balanceAtomic: bigint; lockedAtomic: bigint }> => {
  if (bet.reservation.status === "RELEASED") {
    throw new AppError("Roulette bet reservation already released", 409, "ROULETTE_RESERVATION_RELEASED");
  }

  if (bet.reservation.status === "CAPTURED") {
    const wallet = await tx.wallet.findUnique({
      where: { id: bet.walletId },
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
  }

  const transition = await tx.betReservation.updateMany({
    where: {
      id: bet.reservation.id,
      status: "HELD"
    },
    data: {
      status: "CAPTURED",
      captureIdempotencyKey: idempotencyKey
    }
  });

  if (transition.count === 0) {
    throw new AppError("Roulette reservation state conflict", 409, "ROULETTE_RESERVATION_STATE_CONFLICT");
  }

  const walletRows = await tx.$queryRaw<WalletMutationRow[]>`
    UPDATE "wallets"
    SET "lockedAtomic" = "lockedAtomic" - ${bet.stakeAtomic},
        "updatedAt" = NOW()
    WHERE "id" = ${bet.walletId}
      AND "lockedAtomic" >= ${bet.stakeAtomic}
    RETURNING id, "balanceAtomic", "lockedAtomic"
  `;

  const wallet = walletRows[0];
  if (!wallet) {
    throw new AppError("Wallet lock invariant violated", 409, "WALLET_LOCK_INVARIANT_VIOLATED");
  }

  const captureEntry = await tx.ledgerEntry.create({
    data: {
      walletId: bet.walletId,
      direction: LedgerDirection.DEBIT,
      reason: LedgerReason.BET_CAPTURE,
      amountAtomic: bet.stakeAtomic,
      balanceBeforeAtomic: wallet.balanceAtomic,
      balanceAfterAtomic: wallet.balanceAtomic,
      idempotencyKey,
      referenceId: bet.betReference,
      metadata: {
        game: "ROULETTE",
        roundId: bet.roundId,
        betId: bet.id,
        operation: "CAPTURE",
        lockedAfterAtomic: wallet.lockedAtomic.toString()
      } as Prisma.InputJsonValue
    }
  });

  await tx.betReservation.update({
    where: {
      id: bet.reservation.id
    },
    data: {
      captureTransactionId: captureEntry.id,
      capturedAt: new Date()
    }
  });

  return {
    walletId: wallet.id,
    balanceAtomic: wallet.balanceAtomic,
    lockedAtomic: wallet.lockedAtomic
  };
};

const creditRoulettePayout = async (
  tx: Prisma.TransactionClient,
  walletId: string,
  payoutAtomic: bigint,
  idempotencyKey: string,
  referenceId: string,
  roundId: string,
  betId: string
): Promise<{ walletId: string; balanceAtomic: bigint; lockedAtomic: bigint }> => {
  const walletRows = await tx.$queryRaw<WalletMutationRow[]>`
    UPDATE "wallets"
    SET "balanceAtomic" = "balanceAtomic" + ${payoutAtomic},
        "updatedAt" = NOW()
    WHERE "id" = ${walletId}
    RETURNING id, "balanceAtomic", "lockedAtomic"
  `;

  const wallet = walletRows[0];
  if (!wallet) {
    throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
  }

  const balanceBefore = wallet.balanceAtomic - payoutAtomic;

  await tx.ledgerEntry.create({
    data: {
      walletId,
      direction: LedgerDirection.CREDIT,
      reason: LedgerReason.BET_PAYOUT,
      amountAtomic: payoutAtomic,
      balanceBeforeAtomic: balanceBefore,
      balanceAfterAtomic: wallet.balanceAtomic,
      idempotencyKey,
      referenceId,
      metadata: {
        game: "ROULETTE",
        roundId,
        betId,
        operation: "PAYOUT",
        lockedAfterAtomic: wallet.lockedAtomic.toString()
      } as Prisma.InputJsonValue
    }
  });

  return {
    walletId: wallet.id,
    balanceAtomic: wallet.balanceAtomic,
    lockedAtomic: wallet.lockedAtomic
  };
};

const settleRoundOnce = async (
  now: Date
): Promise<{ round: RouletteRound; outcomes: RouletteSettlementOutcome[] } | null> =>
  prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<RoundTransitionRow[]>`
      SELECT id
      FROM "roulette_rounds"
      WHERE "status" = ${RouletteRoundStatus.SPINNING}
        AND "settleAt" <= ${now}
      ORDER BY "settleAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    const row = lockedRows[0];
    if (!row) {
      return null;
    }

    const round = await tx.rouletteRound.findUnique({
      where: {
        id: row.id
      },
      include: {
        bets: {
          where: {
            status: RouletteBetStatus.PENDING
          },
          include: {
            reservation: {
              select: {
                id: true,
                walletId: true,
                status: true
              }
            },
            round: true,
            user: {
              select: {
                id: true,
                email: true
              }
            }
          }
        }
      }
    });

    if (!round) {
      return null;
    }

    const winningNumber =
      typeof round.winningNumber === "number"
        ? round.winningNumber
        : randomInt(ROULETTE_MIN_NUMBER, ROULETTE_MAX_NUMBER + 1);
    const winningColor = round.winningColor ?? getRouletteColor(winningNumber);
    let totalPayoutAtomic = 0n;
    const perUserNet = new Map<string, RouletteSettlementOutcome>();

    for (const bet of round.bets as RouletteBetWithRelations[]) {
      const captureKey = `roulette:${round.id}:${bet.id}:capture`;
      let walletSnapshot = await captureReservationForRouletteBet(tx, bet, captureKey);

      const evaluation = evaluateRouletteBet(bet.betType, winningNumber, bet.betValue ?? undefined);
      const payoutAtomic = evaluation.won ? computePayoutAtomic(bet.stakeAtomic, evaluation.payoutMultiplier) : 0n;

      if (payoutAtomic > 0n) {
        walletSnapshot = await creditRoulettePayout(
          tx,
          walletSnapshot.walletId,
          payoutAtomic,
          `roulette:${round.id}:${bet.id}:payout`,
          bet.betReference,
          round.id,
          bet.id
        );
      }

      totalPayoutAtomic += payoutAtomic;
      const netAtomic = payoutAtomic - bet.stakeAtomic;
      const existing = perUserNet.get(bet.userId);
      if (existing) {
        existing.netAtomic += netAtomic;
      } else {
        perUserNet.set(bet.userId, {
          userId: bet.userId,
          userLabel: formatUserLabel(bet.user.email, bet.user.id),
          netAtomic
        });
      }

      await tx.rouletteBet.update({
        where: { id: bet.id },
        data: {
          status: evaluation.won ? RouletteBetStatus.WON : RouletteBetStatus.LOST,
          payoutAtomic,
          settledAt: now
        }
      });
    }

    const updatedRound = await tx.rouletteRound.update({
      where: {
        id: round.id
      },
      data: {
        status: RouletteRoundStatus.SETTLED,
        winningNumber,
        winningColor,
        settledAt: now,
        totalPayoutAtomic
      }
    });

    await tx.outboxEvent.create({
      data: {
        type: "ROULETTE_ROUND_SETTLED",
        payload: {
          roundId: round.id,
          roundNumber: round.roundNumber,
          currency: round.currency,
          winningNumber,
          winningColor,
          totalStakedAtomic: round.totalStakedAtomic.toString(),
          totalPayoutAtomic: totalPayoutAtomic.toString()
        }
      }
    });

    const outcomes = Array.from(perUserNet.values()).sort((a, b) => {
      if (a.netAtomic === b.netAtomic) {
        return a.userId.localeCompare(b.userId);
      }
      return a.netAtomic > b.netAtomic ? -1 : 1;
    });

    return { round: updatedRound, outcomes };
  });

const closeRoundOnce = async (now: Date): Promise<RouletteRound | null> =>
  prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<RoundTransitionRow[]>`
      SELECT id
      FROM "roulette_rounds"
      WHERE "status" = ${RouletteRoundStatus.OPEN}
        AND "betsCloseAt" <= ${now}
      ORDER BY "betsCloseAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    const row = lockedRows[0];
    if (!row) {
      return null;
    }

    return tx.rouletteRound.update({
      where: {
        id: row.id
      },
      data: {
        status: RouletteRoundStatus.CLOSED,
        closedAt: now
      }
    });
  });

const startSpinningRoundOnce = async (now: Date): Promise<RouletteRound | null> =>
  prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<RoundTransitionRow[]>`
      SELECT id
      FROM "roulette_rounds"
      WHERE "status" = ${RouletteRoundStatus.CLOSED}
        AND "spinStartsAt" <= ${now}
      ORDER BY "spinStartsAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    const row = lockedRows[0];
    if (!row) {
      return null;
    }

    return tx.rouletteRound.update({
      where: {
        id: row.id
      },
      data: {
        status: RouletteRoundStatus.SPINNING,
        spinningAt: now
      }
    });
  });

const processTransitions = async (logger: FastifyBaseLogger): Promise<void> => {
  const now = new Date();

  for (let i = 0; i < 20; i += 1) {
    const closed = await closeRoundOnce(now);
    if (!closed) {
      break;
    }

    emitRoundEvent(closed);
    logger.debug({ roundId: closed.id, roundNumber: closed.roundNumber }, "Roulette round closed");
  }

  for (let i = 0; i < 20; i += 1) {
    const spinning = await startSpinningRoundOnce(now);
    if (!spinning) {
      break;
    }

    emitRoundEvent(spinning);
    logger.debug({ roundId: spinning.id, roundNumber: spinning.roundNumber }, "Roulette round spinning");
  }

  for (let i = 0; i < 10; i += 1) {
    const settled = await settleRoundOnce(now);
    if (!settled) {
      break;
    }

    emitRoundEvent(settled.round);
    if (settled.round.winningNumber !== null && settled.round.winningColor) {
      emitSettlementSummaryEvent({
        roundId: settled.round.id,
        roundNumber: settled.round.roundNumber,
        currency: settled.round.currency,
        winningNumber: settled.round.winningNumber,
        winningColor: settled.round.winningColor,
        outcomes: settled.outcomes
      });
    }
    void enqueueAuditEvent({
      type: "ROULETTE_ROUND_SETTLED",
      metadata: {
        roundId: settled.round.id,
        roundNumber: settled.round.roundNumber,
        currency: settled.round.currency,
        winningNumber: settled.round.winningNumber,
        winningColor: settled.round.winningColor,
        totalStakedAtomic: settled.round.totalStakedAtomic.toString(),
        totalPayoutAtomic: settled.round.totalPayoutAtomic.toString()
      }
    });

    logger.debug({ roundId: settled.round.id, roundNumber: settled.round.roundNumber }, "Roulette round settled");
  }
};

const ensureOpenRounds = async (): Promise<void> => {
  for (const currency of SUPPORTED_CURRENCIES) {
    const active = await findActiveRound(currency);
    if (!active && !(await shouldWaitBeforeOpeningRound(currency))) {
      await ensureOpenRoundForCurrency(currency);
    }
  }
};

const findExistingBetByIdempotency = async (
  userId: string,
  idempotencyKey: string
): Promise<RouletteBetPlacementResult | null> => {
  const existing = await prisma.rouletteBet.findUnique({
    where: {
      userId_idempotencyKey: {
        userId,
        idempotencyKey
      }
    },
    include: {
      round: true
    }
  });

  if (!existing) {
    return null;
  }

  const wallet = await getWalletSnapshot(existing.walletId);
  return {
    round: toRoundState(existing.round),
    bet: toBetState(existing),
    wallet
  };
};

export const setRouletteBroadcaster = (next: RouletteBroadcaster | null): void => {
  broadcaster = next;
};

export const startRouletteRoundWorker = async (logger: FastifyBaseLogger): Promise<void> => {
  if (workerTimer) {
    return;
  }

  await ensureOpenRounds();

  workerTimer = setInterval(() => {
    if (workerProcessing) {
      return;
    }

    workerProcessing = true;
    void (async () => {
      try {
        await processTransitions(logger);
        await ensureOpenRounds();
      } catch (error) {
        logger.error({ err: error }, "Roulette worker tick failed");
      } finally {
        workerProcessing = false;
      }
    })();
  }, WORKER_TICK_MS);

  workerTimer.unref();
  logger.info("Roulette round worker started");
};

export const stopRouletteRoundWorker = (): void => {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
};

export const getCurrentRouletteRound = async (currency: Currency): Promise<RouletteRoundState> => {
  if (currency !== PLATFORM_INTERNAL_CURRENCY) {
    throw new AppError(
      `Only ${PLATFORM_INTERNAL_CURRENCY} is supported as internal virtual currency`,
      400,
      "UNSUPPORTED_CURRENCY"
    );
  }

  const active = await findActiveRound(currency);
  if (active) {
    return toRoundState(active);
  }

  if (await shouldWaitBeforeOpeningRound(currency)) {
    const latestSettled = await findLatestSettledRound(currency);
    if (latestSettled) {
      return toRoundState(latestSettled);
    }
  }

  const round = await ensureOpenRoundForCurrency(currency);
  return toRoundState(round);
};

export const getCurrentRouletteBetBreakdown = async (currency: Currency): Promise<RouletteBetBreakdownState> => {
  const round = await getCurrentRouletteRound(currency);
  const breakdown = await loadBetBreakdownByRoundId(round.id);
  return {
    roundId: round.id,
    roundNumber: round.roundNumber,
    currency: round.currency,
    totalsAtomic: breakdown.totals,
    entriesByType: breakdown.entriesByType,
    totalStakedAtomic: round.totalStakedAtomic
  };
};

export const getRouletteBetBreakdownByRoundId = async (roundId: string): Promise<RouletteBetBreakdownState> => {
  const round = await prisma.rouletteRound.findUnique({
    where: { id: roundId }
  });

  if (!round) {
    throw new AppError("Roulette round not found", 404, "ROULETTE_ROUND_NOT_FOUND");
  }

  const breakdown = await loadBetBreakdownByRoundId(round.id);
  return {
    roundId: round.id,
    roundNumber: round.roundNumber,
    currency: round.currency,
    totalsAtomic: breakdown.totals,
    entriesByType: breakdown.entriesByType,
    totalStakedAtomic: round.totalStakedAtomic
  };
};

export const listRecentRouletteResults = async (
  currency: Currency,
  limit: number
): Promise<RouletteResultHistoryItem[]> => {
  const rounds = await prisma.rouletteRound.findMany({
    where: {
      currency,
      status: RouletteRoundStatus.SETTLED,
      winningNumber: {
        not: null
      }
    },
    orderBy: {
      settledAt: "desc"
    },
    take: limit
  });

  return rounds
    .filter((round): round is RouletteRound & { winningNumber: number; winningColor: string; settledAt: Date } => {
      return (
        typeof round.winningNumber === "number" &&
        typeof round.winningColor === "string" &&
        round.settledAt instanceof Date
      );
    })
    .map((round) => ({
      roundId: round.id,
      roundNumber: round.roundNumber,
      currency: round.currency,
      winningNumber: round.winningNumber,
      winningColor: round.winningColor,
      totalStakedAtomic: round.totalStakedAtomic,
      totalPayoutAtomic: round.totalPayoutAtomic,
      settledAt: round.settledAt
    }));
};

export const getRouletteRoundById = async (roundId: string): Promise<RouletteRoundState> => {
  const round = await prisma.rouletteRound.findUnique({
    where: {
      id: roundId
    }
  });

  if (!round) {
    throw new AppError("Roulette round not found", 404, "ROULETTE_ROUND_NOT_FOUND");
  }

  return toRoundState(round);
};

export const listUserRouletteBets = async (userId: string, limit: number): Promise<RouletteBetState[]> => {
  const bets = await prisma.rouletteBet.findMany({
    where: {
      userId
    },
    orderBy: {
      createdAt: "desc"
    },
    take: limit
  });

  return bets.map((bet) => toBetState(bet));
};

export const placeRouletteBet = async (input: PlaceRouletteBetInput): Promise<RouletteBetPlacementResult> => {
  if (input.currency !== PLATFORM_INTERNAL_CURRENCY) {
    throw new AppError(
      `Only ${PLATFORM_INTERNAL_CURRENCY} is supported as internal virtual currency`,
      400,
      "UNSUPPORTED_CURRENCY"
    );
  }

  if (input.stakeAtomic <= 0n) {
    throw new AppError("stakeAtomic must be greater than 0", 400, "INVALID_STAKE");
  }

  try {
    validateRouletteBetInput(input.betType, input.betValue);
  } catch (error) {
    throw new AppError((error as Error).message, 400, "INVALID_BET_INPUT");
  }

  const existing = await findExistingBetByIdempotency(input.userId, input.idempotencyKey);
  if (existing) {
    return existing;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let round: RouletteRound | null = null;

      if (input.roundId) {
        round = await tx.rouletteRound.findUnique({
          where: {
            id: input.roundId
          }
        });
      } else {
        const latestActive = await tx.rouletteRound.findFirst({
          where: {
            currency: input.currency,
            status: {
              in: [RouletteRoundStatus.OPEN, RouletteRoundStatus.CLOSED, RouletteRoundStatus.SPINNING]
            }
          },
          orderBy: {
            roundNumber: "desc"
          }
        });

        if (latestActive?.status === RouletteRoundStatus.OPEN) {
          round = latestActive;
        } else if (latestActive) {
          throw new AppError(
            "Roulette betting is closed while the current round is spinning/settling",
            409,
            "ROULETTE_BETTING_CLOSED"
          );
        } else {
          const latestSettled = await tx.rouletteRound.findFirst({
            where: {
              currency: input.currency,
              status: RouletteRoundStatus.SETTLED
            },
            orderBy: {
              settledAt: "desc"
            },
            select: {
              settledAt: true
            }
          });

          if (
            latestSettled?.settledAt &&
            Date.now() - latestSettled.settledAt.getTime() < ROUND_RESULTS_PAUSE_MS
          ) {
            throw new AppError(
              "Roulette is showing settlement results. Betting will reopen shortly.",
              409,
              "ROULETTE_RESULTS_PAUSE_ACTIVE"
            );
          }
        }
      }

      if (!round) {
        round = await createRoundForCurrencyTx(tx, input.currency);
      }

      if (round.currency !== input.currency) {
        throw new AppError("Round currency mismatch", 409, "ROUND_CURRENCY_MISMATCH");
      }

      const now = new Date();
      const roundRows = await tx.$queryRaw<
        Array<{
          id: string;
          status: RouletteRoundStatus;
          totalStakedAtomic: bigint;
          roundNumber: number;
          openAt: Date;
          betsCloseAt: Date;
          spinStartsAt: Date;
          settleAt: Date;
          winningNumber: number | null;
          winningColor: string | null;
          totalPayoutAtomic: bigint;
          currency: Currency;
          createdAt: Date;
          updatedAt: Date;
          closedAt: Date | null;
          spinningAt: Date | null;
          settledAt: Date | null;
          cancelledAt: Date | null;
          createdByUserId: string | null;
        }>
      >`UPDATE "roulette_rounds"
         SET "totalStakedAtomic" = "totalStakedAtomic" + ${input.stakeAtomic},
             "updatedAt" = NOW()
         WHERE "id" = ${round.id}
           AND "status" = ${RouletteRoundStatus.OPEN}
           AND "betsCloseAt" > ${now}
         RETURNING *`;

      const lockedRound = roundRows[0];
      if (!lockedRound) {
        throw new AppError("Roulette round is closed for betting", 409, "ROULETTE_ROUND_CLOSED");
      }

      const wallet = await debitBalanceInTx(tx, {
        userId: input.userId,
        currency: input.currency,
        amountAtomic: input.stakeAtomic,
        lockAmountAtomic: input.stakeAtomic
      });

      const betReference = `roulette:${lockedRound.id}:${randomUUID()}`;

      const holdEntry = await tx.ledgerEntry.create({
        data: {
          walletId: wallet.walletId,
          direction: LedgerDirection.DEBIT,
          reason: LedgerReason.BET_HOLD,
          amountAtomic: input.stakeAtomic,
          balanceBeforeAtomic: wallet.balanceBeforeAtomic,
          balanceAfterAtomic: wallet.balanceAtomic,
          idempotencyKey: input.idempotencyKey,
          referenceId: betReference,
          metadata: {
            game: "ROULETTE",
            roundId: lockedRound.id,
            operation: "HOLD",
            lockedAfterAtomic: wallet.lockedAtomic.toString(),
            betType: input.betType,
            betValue: input.betValue ?? null
          } as Prisma.InputJsonValue
        }
      });

      const reservation = await tx.betReservation.create({
        data: {
          userId: input.userId,
          walletId: wallet.walletId,
          currency: input.currency,
          betReference,
          amountAtomic: input.stakeAtomic,
          holdIdempotencyKey: input.idempotencyKey,
          holdTransactionId: holdEntry.id,
          metadata: {
            game: "ROULETTE",
            roundId: lockedRound.id,
            betType: input.betType,
            betValue: input.betValue ?? null
          } as Prisma.InputJsonValue
        }
      });

      const bet = await tx.rouletteBet.create({
        data: {
          roundId: lockedRound.id,
          userId: input.userId,
          walletId: wallet.walletId,
          currency: input.currency,
          betType: input.betType,
          betValue: input.betValue,
          stakeAtomic: input.stakeAtomic,
          idempotencyKey: input.idempotencyKey,
          betReference,
          reservationId: reservation.id
        }
      });

      await tx.outboxEvent.create({
        data: {
          type: "ROULETTE_BET_PLACED",
          payload: {
            userId: input.userId,
            roundId: lockedRound.id,
            roundNumber: lockedRound.roundNumber,
            currency: input.currency,
            betId: bet.id,
            betType: input.betType,
            betValue: input.betValue ?? null,
            stakeAtomic: input.stakeAtomic.toString()
          }
        }
      });

      const roundState: RouletteRound = {
        ...lockedRound,
        totalStakedAtomic: lockedRound.totalStakedAtomic,
        totalPayoutAtomic: lockedRound.totalPayoutAtomic
      };

      return {
        round: toRoundState(roundState),
        bet: toBetState(bet),
        wallet: {
          walletId: wallet.walletId,
          balanceAtomic: wallet.balanceAtomic,
          lockedAtomic: wallet.lockedAtomic
        }
      };
    });

    emitTotalsEvent(result.round.id, result.round.currency, result.round.totalStakedAtomic);
    const breakdown = await getRouletteBetBreakdownByRoundId(result.round.id);
    emitBetBreakdownEvent(breakdown);

    void enqueueAuditEvent({
      type: "ROULETTE_BET_PLACED",
      actorId: input.userId,
      targetId: input.userId,
      metadata: {
        roundId: result.round.id,
        betId: result.bet.id,
        currency: result.bet.currency,
        betType: result.bet.betType,
        betValue: result.bet.betValue,
        stakeAtomic: result.bet.stakeAtomic.toString()
      }
    });

    return result;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const replay = await findExistingBetByIdempotency(input.userId, input.idempotencyKey);
      if (replay) {
        return replay;
      }
    }

    throw error;
  }
};
