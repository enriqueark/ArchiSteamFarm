import { LedgerDirection, LedgerReason, UserRole, Prisma } from "@prisma/client";

import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";
import { getRouletteBroadcaster } from "../roulette/service";
import { PLATFORM_INTERNAL_CURRENCY, PLATFORM_VIRTUAL_COIN_DECIMALS } from "../wallets/service";

const COIN_ATOMIC = 10n ** BigInt(PLATFORM_VIRTUAL_COIN_DECIMALS);
const MIN_TIP_ATOMIC = COIN_ATOMIC;
const RAIN_BASE_ATOMIC = 5n * COIN_ATOMIC;
const RAIN_SOURCE_SEED = "rain-hourly-seed";

const halfHourStart = (date: Date): Date => {
  const minuteBucket = date.getUTCMinutes() < 30 ? 0 : 30;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), minuteBucket, 0, 0));
};

const addMinutes = (date: Date, minutes: number): Date => {
  const copy = new Date(date);
  copy.setUTCMinutes(copy.getUTCMinutes() + minutes);
  return copy;
};

const RAIN_JOIN_WINDOW_MS = 60_000;

const userLabel = (email: string): string => {
  const local = email.split("@")[0]?.trim();
  if (!local) {
    return "Player";
  }
  return local.slice(0, 24);
};

const toCoinsString = (atomic: bigint): string => {
  const abs = atomic < 0n ? -atomic : atomic;
  const whole = abs / COIN_ATOMIC;
  const fraction = (abs % COIN_ATOMIC).toString().padStart(8, "0").slice(0, 2);
  return `${whole.toString()}.${fraction}`;
};

const lockWallet = async (tx: Prisma.TransactionClient, userId: string) => {
  const rows = await tx.$queryRaw<Array<{ id: string; balanceAtomic: bigint }>>`
    SELECT id, "balanceAtomic"
    FROM "wallets"
    WHERE "userId" = ${userId}
      AND "currency" = ${PLATFORM_INTERNAL_CURRENCY}
    FOR UPDATE
  `;
  const wallet = rows[0];
  if (!wallet) {
    throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
  }
  return wallet;
};

const ensureCurrentRainRound = async (tx: Prisma.TransactionClient, now: Date) => {
  const start = halfHourStart(now);
  const end = addMinutes(start, 30);
  const existing = await tx.rainRound.findFirst({
    where: {
      startsAt: start,
      endsAt: end
    }
  });
  if (existing) {
    return existing;
  }
  return tx.rainRound.create({
    data: {
      startsAt: start,
      endsAt: end,
      baseAmountAtomic: RAIN_BASE_ATOMIC,
      tippedAmountAtomic: 0n
    }
  });
};

const settlePreviousRoundIfNeeded = async (tx: Prisma.TransactionClient, now: Date): Promise<void> => {
  const previous = await tx.rainRound.findFirst({
    where: {
      endsAt: { lte: now },
      settledAt: null
    },
    orderBy: { endsAt: "asc" },
    include: {
      joins: {
        include: {
          user: {
            select: { id: true, email: true }
          }
        }
      }
    }
  });
  if (!previous) {
    return;
  }

  const totalPot = previous.baseAmountAtomic + previous.tippedAmountAtomic;
  const participants = previous.joins;
  if (!participants.length || totalPot <= 0n) {
    await tx.rainRound.update({
      where: { id: previous.id },
      data: { settledAt: now }
    });
    return;
  }

  const count = BigInt(participants.length);
  const baseShare = totalPot / count;
  let remainder = totalPot % count;

  for (const join of participants) {
    let payout = baseShare;
    if (remainder > 0n) {
      payout += 1n;
      remainder -= 1n;
    }
    if (payout <= 0n) {
      continue;
    }
    const wallet = await lockWallet(tx, join.userId);
    const before = wallet.balanceAtomic;
    const after = before + payout;
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balanceAtomic: after }
    });
    await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        direction: LedgerDirection.CREDIT,
        reason: LedgerReason.RAIN_PAYOUT,
        amountAtomic: payout,
        balanceBeforeAtomic: before,
        balanceAfterAtomic: after,
        idempotencyKey: `rain:payout:${previous.id}:${join.userId}`,
        referenceId: previous.id,
        metadata: {
          game: "CHAT",
          operation: "RAIN_PAYOUT",
          roundId: previous.id
        } as Prisma.InputJsonValue
      }
    });
  }

  await tx.rainRound.update({
    where: { id: previous.id },
    data: { settledAt: now }
  });
};

const emitRainPayoutsForSettledRound = async (roundId: string): Promise<void> => {
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      reason: LedgerReason.RAIN_PAYOUT,
      referenceId: roundId
    },
    select: {
      wallet: {
        select: {
          userId: true
        }
      },
      amountAtomic: true
    }
  });

  for (const entry of entries) {
    getRouletteBroadcaster()?.broadcast({
      type: "rain.payout",
      data: {
        roundId,
        userId: entry.wallet.userId,
        payoutAtomic: entry.amountAtomic.toString()
      }
    });
  }
};

const emitRainSummaryMessage = async (roundId: string): Promise<void> => {
  const round = await prisma.rainRound.findUnique({
    where: { id: roundId },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      baseAmountAtomic: true,
      tippedAmountAtomic: true,
      joins: {
        select: {
          userId: true,
          user: {
            select: {
              publicId: true,
              email: true
            }
          }
        }
      }
    }
  });
  if (!round) {
    return;
  }

  const payouts = await prisma.ledgerEntry.findMany({
    where: {
      reason: LedgerReason.RAIN_PAYOUT,
      referenceId: roundId
    },
    select: {
      wallet: {
        select: {
          userId: true
        }
      },
      amountAtomic: true
    }
  });

  const totalGiven = payouts.reduce((sum, row) => sum + row.amountAtomic, 0n);
  const winnerIds = new Set<string>(payouts.map((row) => row.wallet.userId));
  const participants = round.joins
    .filter((join) => winnerIds.has(join.userId))
    .map((join) => ({
      userId: join.userId,
      userPublicId: join.user.publicId ?? null,
      userLabel: userLabel(join.user.email)
    }));

  getRouletteBroadcaster()?.broadcast({
    type: "rain.settled",
    data: {
      roundId: round.id,
      startsAt: round.startsAt.toISOString(),
      endsAt: round.endsAt.toISOString(),
      totalAmountAtomic: (round.baseAmountAtomic + round.tippedAmountAtomic).toString(),
      givenAmountAtomic: totalGiven.toString(),
      givenAmountCoins: toCoinsString(totalGiven),
      winnerCount: participants.length,
      winners: participants
    }
  });
  if (participants.length > 0) {
    getRouletteBroadcaster()?.broadcast({
      type: "chat.message",
      data: {
        id: `rain-summary:${round.id}`,
        userId: "system",
        userPublicId: null,
        userLabel: "System",
        level: 0,
        avatarUrl: null,
        message: `Rain just given out ${toCoinsString(totalGiven)} coins to ${participants.length} users`,
        createdAt: new Date().toISOString()
      }
    });
  }
};

export type RainRoundState = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  baseAmountAtomic: bigint;
  tippedAmountAtomic: bigint;
  totalAmountAtomic: bigint;
  participantCount: number;
  hasJoined: boolean;
};

export const getCurrentRainState = async (userId?: string): Promise<RainRoundState> => {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await settlePreviousRoundIfNeeded(tx, now);
    const current = await ensureCurrentRainRound(tx, now);
    const [participantCount, hasJoined] = await Promise.all([
      tx.rainJoin.count({ where: { roundId: current.id } }),
      userId
        ? tx.rainJoin
            .findFirst({
              where: { roundId: current.id, userId },
              select: { id: true }
            })
            .then((row) => Boolean(row))
        : Promise.resolve(false)
    ]);

    return {
      id: current.id,
      startsAt: current.startsAt,
      endsAt: current.endsAt,
      baseAmountAtomic: current.baseAmountAtomic,
      tippedAmountAtomic: current.tippedAmountAtomic,
      totalAmountAtomic: current.baseAmountAtomic + current.tippedAmountAtomic,
      participantCount,
      hasJoined
    };
  });
};

export const joinRain = async (userId: string): Promise<RainRoundState> => {
  const now = new Date();
  const state = await prisma.$transaction(async (tx) => {
    await settlePreviousRoundIfNeeded(tx, now);
    const round = await ensureCurrentRainRound(tx, now);
    const msUntilRoundEnd = round.endsAt.getTime() - now.getTime();
    if (msUntilRoundEnd > RAIN_JOIN_WINDOW_MS) {
      throw new AppError("You can only join rain in the last minute", 422, "RAIN_JOIN_WINDOW_CLOSED");
    }
    if (msUntilRoundEnd <= 0) {
      throw new AppError("Rain round already ended", 422, "RAIN_ROUND_ENDED");
    }
    await tx.rainJoin.create({
      data: {
        roundId: round.id,
        userId
      }
    }).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return null;
      }
      throw error;
    });

    const participantCount = await tx.rainJoin.count({ where: { roundId: round.id } });
    return {
      id: round.id,
      startsAt: round.startsAt,
      endsAt: round.endsAt,
      baseAmountAtomic: round.baseAmountAtomic,
      tippedAmountAtomic: round.tippedAmountAtomic,
      totalAmountAtomic: round.baseAmountAtomic + round.tippedAmountAtomic,
      participantCount,
      hasJoined: true
    };
  });

  getRouletteBroadcaster()?.broadcast({
    type: "rain.joined",
    data: {
      roundId: state.id,
      userId,
      joinedCount: state.participantCount
    }
  });

  return state;
};

export const tipRain = async (input: { fromUserId: string; amountCoins: number }) => {
  const amountAtomic = BigInt(Math.round(input.amountCoins * Number(COIN_ATOMIC)));
  if (amountAtomic <= 0n) {
    throw new AppError("Invalid tip amount", 400, "INVALID_AMOUNT");
  }
  if (amountAtomic < MIN_TIP_ATOMIC) {
    throw new AppError("Minimum rain tip is 1 coin", 400, "RAIN_MIN_TIP");
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: input.fromUserId },
      select: { canTip: true }
    });
    if (!user?.canTip) {
      throw new AppError("Tipping is disabled for this account", 403, "TIP_DISABLED");
    }

    await settlePreviousRoundIfNeeded(tx, now);
    const round = await ensureCurrentRainRound(tx, now);
    const wallet = await lockWallet(tx, input.fromUserId);
    if (wallet.balanceAtomic < amountAtomic) {
      throw new AppError("Insufficient funds", 422, "INSUFFICIENT_FUNDS");
    }

    const before = wallet.balanceAtomic;
    const after = before - amountAtomic;
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balanceAtomic: after }
    });
    await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        direction: LedgerDirection.DEBIT,
        reason: LedgerReason.RAIN_TIP,
        amountAtomic,
        balanceBeforeAtomic: before,
        balanceAfterAtomic: after,
        idempotencyKey: `rain:tip:${round.id}:${input.fromUserId}:${Date.now()}`,
        referenceId: round.id,
        metadata: {
          game: "CHAT",
          operation: "RAIN_TIP",
          roundId: round.id
        } as Prisma.InputJsonValue
      }
    });

    const tip = await tx.rainTip.create({
      data: {
        roundId: round.id,
        userId: input.fromUserId,
        amountAtomic
      }
    });
    const updated = await tx.rainRound.update({
      where: { id: round.id },
      data: {
        tippedAmountAtomic: {
          increment: amountAtomic
        }
      }
    });
    const participantCount = await tx.rainJoin.count({ where: { roundId: round.id } });
    return {
      id: updated.id,
      startsAt: updated.startsAt,
      endsAt: updated.endsAt,
      baseAmountAtomic: updated.baseAmountAtomic,
      tippedAmountAtomic: updated.tippedAmountAtomic,
      totalAmountAtomic: updated.baseAmountAtomic + updated.tippedAmountAtomic,
      participantCount,
      hasJoined: Boolean(await tx.rainJoin.findFirst({ where: { roundId: updated.id, userId: input.fromUserId } })),
      tipId: tip.id,
      tipAmountAtomic: amountAtomic,
      tipCreatedAt: tip.createdAt
    };
  });

  getRouletteBroadcaster()?.broadcast({
    type: "rain.tipped",
    data: {
      roundId: result.id,
      userId: input.fromUserId,
      amountAtomic: result.tipAmountAtomic.toString(),
      tippedAmountAtomic: result.tippedAmountAtomic.toString(),
      totalAmountAtomic: result.totalAmountAtomic.toString()
    }
  });

  return {
    rain: result,
    tip: {
      id: result.tipId,
      amountAtomic: result.tipAmountAtomic,
      createdAt: result.tipCreatedAt
    }
  };
};

export const tipUser = async (input: {
  fromUserId: string;
  toUserPublicId: number;
  amountCoins: number;
  message?: string;
  silent?: boolean;
  actorRole?: UserRole;
}) => {
  const amountAtomic = BigInt(Math.round(input.amountCoins * Number(COIN_ATOMIC)));
  if (amountAtomic <= 0n) {
    throw new AppError("Invalid tip amount", 400, "INVALID_AMOUNT");
  }
  if (amountAtomic < MIN_TIP_ATOMIC) {
    throw new AppError("Minimum user tip is 1 coin", 400, "USER_TIP_MINIMUM");
  }

  const now = Date.now();
  const tip = await prisma.$transaction(async (tx) => {
    const sender = await tx.user.findUnique({
      where: { id: input.fromUserId },
      select: { id: true, email: true, canTip: true, publicId: true }
    });
    if (!sender) {
      throw new AppError("Sender not found", 404, "USER_NOT_FOUND");
    }
    if (!sender.canTip) {
      throw new AppError("Tipping is disabled for this account", 403, "TIP_DISABLED");
    }

    const recipient = await tx.user.findUnique({
      where: { publicId: input.toUserPublicId },
      select: { id: true, email: true, publicId: true }
    });
    if (!recipient) {
      throw new AppError("Recipient not found", 404, "USER_NOT_FOUND");
    }
    if (recipient.id === sender.id) {
      throw new AppError("You cannot tip yourself", 400, "USER_TIP_SELF");
    }

    const senderWallet = await lockWallet(tx, sender.id);
    const recipientWallet = await lockWallet(tx, recipient.id);

    if (senderWallet.balanceAtomic < amountAtomic) {
      throw new AppError("Insufficient funds", 422, "INSUFFICIENT_FUNDS");
    }

    const senderBefore = senderWallet.balanceAtomic;
    const senderAfter = senderBefore - amountAtomic;
    await tx.wallet.update({
      where: { id: senderWallet.id },
      data: { balanceAtomic: senderAfter }
    });
    await tx.ledgerEntry.create({
      data: {
        walletId: senderWallet.id,
        direction: LedgerDirection.DEBIT,
        reason: LedgerReason.USER_TIP,
        amountAtomic,
        balanceBeforeAtomic: senderBefore,
        balanceAfterAtomic: senderAfter,
        idempotencyKey: `user-tip:debit:${sender.id}:${recipient.id}:${now}`,
        referenceId: `${sender.id}:${recipient.id}`,
        metadata: {
          game: "CHAT",
          operation: "USER_TIP_DEBIT",
          toUserId: recipient.id
        } as Prisma.InputJsonValue
      }
    });

    const recipientBefore = recipientWallet.balanceAtomic;
    const recipientAfter = recipientBefore + amountAtomic;
    await tx.wallet.update({
      where: { id: recipientWallet.id },
      data: { balanceAtomic: recipientAfter }
    });
    await tx.ledgerEntry.create({
      data: {
        walletId: recipientWallet.id,
        direction: LedgerDirection.CREDIT,
        reason: LedgerReason.USER_TIP,
        amountAtomic,
        balanceBeforeAtomic: recipientBefore,
        balanceAfterAtomic: recipientAfter,
        idempotencyKey: `user-tip:credit:${sender.id}:${recipient.id}:${now}`,
        referenceId: `${sender.id}:${recipient.id}`,
        metadata: {
          game: "CHAT",
          operation: "USER_TIP_CREDIT",
          fromUserId: sender.id
        } as Prisma.InputJsonValue
      }
    });

    const created = await tx.userTip.create({
      data: {
        fromUserId: sender.id,
        toUserId: recipient.id,
        amountAtomic,
        message: input.message?.trim() || null
      }
    });

    return {
      id: created.id,
      fromUserId: sender.id,
      fromUserPublicId: sender.publicId ?? null,
      fromUserLabel: userLabel(sender.email),
      toUserId: recipient.id,
      toUserPublicId: recipient.publicId ?? null,
      toUserLabel: userLabel(recipient.email),
      amountAtomic: created.amountAtomic,
      message: created.message,
      createdAt: created.createdAt,
      silent: Boolean(input.silent),
      actorRole: input.actorRole ?? UserRole.PLAYER
    };
  });

  return {
    ...tip,
    amountAtomic: tip.amountAtomic.toString()
  };
};

export const settleEndedRainRounds = async (): Promise<void> => {
  const now = new Date();
  const before = await prisma.rainRound.findFirst({
    where: {
      endsAt: { lte: now },
      settledAt: null
    },
    orderBy: { endsAt: "asc" },
    select: { id: true }
  });
  await prisma.$transaction(async (tx) => {
    await settlePreviousRoundIfNeeded(tx, now);
    await ensureCurrentRainRound(tx, now);
  });
  if (before?.id) {
    await emitRainPayoutsForSettledRound(before.id);
    await emitRainSummaryMessage(before.id);
  }
};

// lightweight no-op export to keep migration seed constant discoverable by tests/tools
export const rainSeedInfo = {
  source: RAIN_SOURCE_SEED,
  baseAtomic: RAIN_BASE_ATOMIC.toString()
};
