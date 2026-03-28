import {
  BetReservationStatus,
  Currency,
  LedgerDirection,
  LedgerReason,
  MinesGame,
  MinesGameStatus,
  Prisma,
  ProvablyFairProfile,
  ProvablyFairSeed
} from "@prisma/client";
import { randomUUID } from "node:crypto";

import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";
import { enqueueAuditEvent } from "../../infrastructure/queue/audit-queue";
import { applyWagerXpInTx } from "../progression/service";
import { MAX_GAME_BET_ATOMIC, PLATFORM_INTERNAL_CURRENCY, debitBalanceInTx } from "../wallets/service";
import {
  BOARD_SIZE,
  MAX_MINES,
  MIN_MINES,
  buildMineIndexes,
  calculateMultiplier,
  calculatePayoutAtomic,
  generateClientSeed,
  generateServerSeed,
  hashServerSeed
} from "./provably-fair";

type WalletSnapshot = {
  walletId: string;
  balanceAtomic: bigint;
  lockedAtomic: bigint;
};

type GameWithRelations = MinesGame & {
  betReservation: {
    id: string;
    walletId: string;
    status: BetReservationStatus;
  };
};

export type MinesGameState = {
  gameId: string;
  status: MinesGameStatus;
  currency: Currency;
  betAtomic: bigint;
  mineCount: number;
  boardSize: number;
  safeReveals: number;
  revealedCells: number[];
  currentMultiplier: number;
  potentialPayoutAtomic: bigint;
  payoutAtomic: bigint | null;
  createdAt: Date;
  finishedAt: Date | null;
  provablyFair: {
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
  };
  wallet: WalletSnapshot;
};

export type MinesRevealResult = {
  state: MinesGameState;
  hitMine: boolean;
  revealedNow: boolean;
  gameResolved: boolean;
};

type StartMinesGameInput = {
  userId: string;
  currency: Currency;
  betAtomic: bigint;
  mineCount: number;
  idempotencyKey: string;
  clientSeedOverride?: string;
};

type RevealTileInput = {
  userId: string;
  gameId: string;
  cellIndex: number;
};

type CashoutInput = {
  userId: string;
  gameId: string;
  idempotencyKey: string;
};

type LockedGameRow = {
  id: string;
};

type NonceAllocationRow = {
  nonce: number;
  activeSeedId: string;
  clientSeed: string;
};

type WalletUpdateRow = {
  id: string;
  balanceAtomic: bigint;
  lockedAtomic: bigint;
};

type ProvablyFairContext = {
  profile: ProvablyFairProfile;
  activeSeed: ProvablyFairSeed;
};

const asMetadataRecord = (value: Prisma.InputJsonValue | undefined): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const isMissingLedgerReasonEnumValue = (error: unknown, reason: LedgerReason): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("invalid input value for enum") && message.includes(reason);
};

const createMinesLedgerEntry = async (
  tx: Prisma.TransactionClient,
  input: {
    walletId: string;
    direction: LedgerDirection;
    reason: LedgerReason;
    amountAtomic: bigint;
    balanceBeforeAtomic: bigint;
    balanceAfterAtomic: bigint;
    idempotencyKey: string;
    referenceId?: string;
    metadata?: Prisma.InputJsonValue;
  }
): Promise<Prisma.PromiseReturnType<typeof tx.ledgerEntry.create>> => {
  try {
    return await tx.ledgerEntry.create({
      data: {
        walletId: input.walletId,
        direction: input.direction,
        reason: input.reason,
        amountAtomic: input.amountAtomic,
        balanceBeforeAtomic: input.balanceBeforeAtomic,
        balanceAfterAtomic: input.balanceAfterAtomic,
        idempotencyKey: input.idempotencyKey,
        referenceId: input.referenceId,
        metadata: input.metadata
      }
    });
  } catch (error) {
    if (isMissingLedgerReasonEnumValue(error, input.reason)) {
      return tx.ledgerEntry.create({
        data: {
          walletId: input.walletId,
          direction: input.direction,
          reason: LedgerReason.ADMIN_ADJUSTMENT,
          amountAtomic: input.amountAtomic,
          balanceBeforeAtomic: input.balanceBeforeAtomic,
          balanceAfterAtomic: input.balanceAfterAtomic,
          idempotencyKey: input.idempotencyKey,
          referenceId: input.referenceId,
          metadata: {
            ...asMetadataRecord(input.metadata),
            reasonFallback: true,
            originalReason: input.reason
          } as Prisma.InputJsonValue
        }
      });
    }
    throw error;
  }
};

const parseRevealedCells = (value: Prisma.JsonValue): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is number => typeof entry === "number" && Number.isInteger(entry))
    .map((entry) => entry);
};

const isUniqueViolation = (error: unknown): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const ensureMineCount = (mineCount: number): void => {
  if (!Number.isInteger(mineCount) || mineCount < MIN_MINES || mineCount > MAX_MINES) {
    throw new AppError(`mineCount must be between ${MIN_MINES} and ${MAX_MINES}`, 400, "INVALID_MINE_COUNT");
  }
};

const ensureWalletSnapshot = (row?: WalletUpdateRow): WalletSnapshot => {
  if (!row) {
    throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
  }

  return {
    walletId: row.id,
    balanceAtomic: row.balanceAtomic,
    lockedAtomic: row.lockedAtomic
  };
};

const getWalletSnapshotById = async (walletId: string): Promise<WalletSnapshot> => {
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

const toMinesGameState = (game: MinesGame, wallet: WalletSnapshot): MinesGameState => {
  const revealedCells = parseRevealedCells(game.revealedCells);
  const currentMultiplier = Number(game.currentMultiplier.toString());
  const potentialPayoutAtomic =
    game.status === MinesGameStatus.LOST ? 0n : calculatePayoutAtomic(game.betAtomic, currentMultiplier);

  return {
    gameId: game.id,
    status: game.status,
    currency: game.currency,
    betAtomic: game.betAtomic,
    mineCount: game.mineCount,
    boardSize: game.boardSize,
    safeReveals: game.safeReveals,
    revealedCells,
    currentMultiplier,
    potentialPayoutAtomic,
    payoutAtomic: game.payoutAtomic ?? null,
    createdAt: game.createdAt,
    finishedAt: game.finishedAt ?? null,
    provablyFair: {
      serverSeedHash: game.serverSeedHash,
      clientSeed: game.clientSeed,
      nonce: game.nonce
    },
    wallet
  };
};

const ensureProvablyFairContext = async (
  tx: Prisma.TransactionClient,
  userId: string
): Promise<ProvablyFairContext> => {
  const existing = await tx.provablyFairProfile.findUnique({
    where: { userId },
    include: {
      activeSeed: true
    }
  });

  if (!existing) {
    const serverSeed = generateServerSeed();
    const activeSeed = await tx.provablyFairSeed.create({
      data: {
        userId,
        serverSeed,
        serverSeedHash: hashServerSeed(serverSeed)
      }
    });

    const profile = await tx.provablyFairProfile.create({
      data: {
        userId,
        clientSeed: generateClientSeed(),
        nonce: 0,
        activeSeedId: activeSeed.id
      }
    });

    return {
      profile,
      activeSeed
    };
  }

  if (existing.activeSeed.status === "ACTIVE") {
    return {
      profile: existing,
      activeSeed: existing.activeSeed
    };
  }

  const serverSeed = generateServerSeed();
  const newSeed = await tx.provablyFairSeed.create({
    data: {
      userId,
      serverSeed,
      serverSeedHash: hashServerSeed(serverSeed)
    }
  });

  const profile = await tx.provablyFairProfile.update({
    where: { userId },
    data: {
      activeSeedId: newSeed.id,
      nonce: 0
    }
  });

  return {
    profile,
    activeSeed: newSeed
  };
};

const lockGameForUpdate = async (
  tx: Prisma.TransactionClient,
  gameId: string,
  userId: string
): Promise<GameWithRelations> => {
  const lockRows = await tx.$queryRaw<LockedGameRow[]>`
    SELECT id
    FROM "mines_games"
    WHERE id = ${gameId}
      AND "userId" = ${userId}
    FOR UPDATE
  `;

  if (!lockRows[0]) {
    throw new AppError("Mines game not found", 404, "MINES_GAME_NOT_FOUND");
  }

  const game = await tx.minesGame.findUnique({
    where: {
      id: gameId
    },
    include: {
      betReservation: {
        select: {
          id: true,
          walletId: true,
          status: true
        }
      }
    }
  });

  if (!game || !game.betReservation) {
    throw new AppError("Mines game integrity error", 500, "MINES_GAME_INTEGRITY_ERROR");
  }

  return game;
};

const captureReservationFunds = async (
  tx: Prisma.TransactionClient,
  game: GameWithRelations,
  idempotencyKey: string
): Promise<WalletSnapshot> => {
  if (game.betReservation.status === BetReservationStatus.CAPTURED) {
    const wallet = await tx.wallet.findUnique({
      where: { id: game.betReservation.walletId },
      select: { id: true, balanceAtomic: true, lockedAtomic: true }
    });

    return ensureWalletSnapshot(
      wallet
        ? { id: wallet.id, balanceAtomic: wallet.balanceAtomic, lockedAtomic: wallet.lockedAtomic }
        : undefined
    );
  }

  if (game.betReservation.status === BetReservationStatus.RELEASED) {
    throw new AppError("Bet reservation was already released", 409, "BET_RESERVATION_RELEASED");
  }

  const transition = await tx.betReservation.updateMany({
    where: {
      id: game.betReservation.id,
      status: BetReservationStatus.HELD
    },
    data: {
      status: BetReservationStatus.CAPTURED,
      captureIdempotencyKey: idempotencyKey
    }
  });

  if (transition.count === 0) {
    throw new AppError("Bet reservation state conflict", 409, "BET_RESERVATION_STATE_CONFLICT");
  }

  const walletRows = await tx.$queryRaw<WalletUpdateRow[]>`
    UPDATE "wallets"
    SET "lockedAtomic" = "lockedAtomic" - ${game.betAtomic},
        "updatedAt" = NOW()
    WHERE "id" = ${game.betReservation.walletId}
      AND "lockedAtomic" >= ${game.betAtomic}
    RETURNING id, "balanceAtomic", "lockedAtomic"
  `;

  const wallet = ensureWalletSnapshot(walletRows[0]);

  let captureEntryId: string | null = null;
  try {
    const captureEntry = await createMinesLedgerEntry(tx, {
      walletId: wallet.walletId,
      direction: LedgerDirection.DEBIT,
      reason: LedgerReason.BET_CAPTURE,
      amountAtomic: game.betAtomic,
      balanceBeforeAtomic: wallet.balanceAtomic,
      balanceAfterAtomic: wallet.balanceAtomic,
      idempotencyKey,
      referenceId: game.betReference,
      metadata: {
        gameId: game.id,
        operation: "MINES_CAPTURE",
        lockedAfterAtomic: wallet.lockedAtomic.toString()
      } as Prisma.InputJsonValue
    });
    captureEntryId = captureEntry.id;
  } catch {
    // Keep settlement available even if ledger append fails on legacy deployments.
  }

  await tx.betReservation.update({
    where: {
      id: game.betReservation.id
    },
    data: captureEntryId
      ? {
          captureTransactionId: captureEntryId,
          capturedAt: new Date()
        }
      : {
          capturedAt: new Date()
        }
  });

  return wallet;
};

const creditWalletPayout = async (
  tx: Prisma.TransactionClient,
  walletId: string,
  payoutAtomic: bigint,
  idempotencyKey: string,
  referenceId: string,
  gameId: string
): Promise<WalletSnapshot> => {
  if (payoutAtomic <= 0n) {
    const wallet = await tx.wallet.findUnique({
      where: { id: walletId },
      select: { id: true, balanceAtomic: true, lockedAtomic: true }
    });

    return ensureWalletSnapshot(
      wallet ? { id: wallet.id, balanceAtomic: wallet.balanceAtomic, lockedAtomic: wallet.lockedAtomic } : undefined
    );
  }

  const walletRows = await tx.$queryRaw<WalletUpdateRow[]>`
    UPDATE "wallets"
    SET "balanceAtomic" = "balanceAtomic" + ${payoutAtomic},
        "updatedAt" = NOW()
    WHERE "id" = ${walletId}
    RETURNING id, "balanceAtomic", "lockedAtomic"
  `;

  const wallet = ensureWalletSnapshot(walletRows[0]);
  const balanceBefore = wallet.balanceAtomic - payoutAtomic;

  try {
    await createMinesLedgerEntry(tx, {
      walletId,
      direction: LedgerDirection.CREDIT,
      reason: LedgerReason.BET_PAYOUT,
      amountAtomic: payoutAtomic,
      balanceBeforeAtomic: balanceBefore,
      balanceAfterAtomic: wallet.balanceAtomic,
      idempotencyKey,
      referenceId,
      metadata: {
        gameId,
        operation: "MINES_PAYOUT",
        lockedAfterAtomic: wallet.lockedAtomic.toString()
      } as Prisma.InputJsonValue
    });
  } catch {
    // Keep settlement available even if ledger append fails on legacy deployments.
  }

  return wallet;
};

const resolveExistingStartRequest = async (
  userId: string,
  idempotencyKey: string
): Promise<MinesGameState | null> => {
  const existing = await prisma.minesGame.findFirst({
    where: {
      userId,
      betReservation: {
        is: {
          holdIdempotencyKey: idempotencyKey
        }
      }
    },
    include: {
      betReservation: {
        select: {
          walletId: true
        }
      }
    }
  });

  if (!existing) {
    return null;
  }

  const wallet = await getWalletSnapshotById(existing.betReservation.walletId);
  return toMinesGameState(existing, wallet);
};

export const getOrCreateProvablyFairState = async (userId: string) => {
  const context = await prisma.$transaction((tx) => ensureProvablyFairContext(tx, userId));
  const revealedSeeds = await prisma.provablyFairSeed.findMany({
    where: {
      userId,
      status: "REVEALED"
    },
    orderBy: {
      revealedAt: "desc"
    },
    take: 10,
    select: {
      id: true,
      serverSeed: true,
      serverSeedHash: true,
      createdAt: true,
      revealedAt: true
    }
  });

  return {
    clientSeed: context.profile.clientSeed,
    nonce: context.profile.nonce,
    activeServerSeedHash: context.activeSeed.serverSeedHash,
    revealedSeeds
  };
};

export const setProvablyFairClientSeed = async (userId: string, clientSeed: string) => {
  if (clientSeed.trim().length < 8 || clientSeed.trim().length > 128) {
    throw new AppError("clientSeed must be between 8 and 128 characters", 400, "INVALID_CLIENT_SEED");
  }

  const result = await prisma.$transaction(async (tx) => {
    await ensureProvablyFairContext(tx, userId);
    const updated = await tx.provablyFairProfile.update({
      where: {
        userId
      },
      data: {
        clientSeed: clientSeed.trim()
      },
      include: {
        activeSeed: true
      }
    });

    return {
      clientSeed: updated.clientSeed,
      nonce: updated.nonce,
      activeServerSeedHash: updated.activeSeed.serverSeedHash
    };
  });

  void enqueueAuditEvent({
    type: "PROVABLY_FAIR_CLIENT_SEED_UPDATED",
    actorId: userId,
    targetId: userId,
    metadata: {
      nonce: result.nonce,
      activeServerSeedHash: result.activeServerSeedHash
    }
  });

  return result;
};

export const rotateProvablyFairServerSeed = async (userId: string) => {
  const result = await prisma.$transaction(async (tx) => {
    const context = await ensureProvablyFairContext(tx, userId);

    const activeGames = await tx.minesGame.count({
      where: {
        userId,
        status: MinesGameStatus.ACTIVE,
        finishedAt: null,
        serverSeedId: context.activeSeed.id,
        betReservation: {
          is: {
            status: BetReservationStatus.HELD
          }
        }
      }
    });

    if (activeGames > 0) {
      throw new AppError(
        "Cannot rotate server seed while active Mines games exist",
        409,
        "ACTIVE_MINES_GAMES_BLOCK_SEED_ROTATION"
      );
    }

    const newServerSeed = generateServerSeed();
    const newSeed = await tx.provablyFairSeed.create({
      data: {
        userId,
        serverSeed: newServerSeed,
        serverSeedHash: hashServerSeed(newServerSeed)
      }
    });

    const now = new Date();
    await tx.provablyFairSeed.update({
      where: {
        id: context.activeSeed.id
      },
      data: {
        status: "REVEALED",
        revealedAt: now
      }
    });

    const updatedProfile = await tx.provablyFairProfile.update({
      where: {
        userId
      },
      data: {
        activeSeedId: newSeed.id,
        nonce: 0
      }
    });

    return {
      revealedServerSeed: context.activeSeed.serverSeed,
      revealedServerSeedHash: context.activeSeed.serverSeedHash,
      newServerSeedHash: newSeed.serverSeedHash,
      clientSeed: updatedProfile.clientSeed,
      nonce: updatedProfile.nonce
    };
  });

  void enqueueAuditEvent({
    type: "PROVABLY_FAIR_SERVER_SEED_ROTATED",
    actorId: userId,
    targetId: userId,
    metadata: {
      revealedServerSeedHash: result.revealedServerSeedHash,
      newServerSeedHash: result.newServerSeedHash
    }
  });

  return result;
};

export const startMinesGame = async (input: StartMinesGameInput): Promise<MinesGameState> => {
  ensureMineCount(input.mineCount);

  if (input.currency !== PLATFORM_INTERNAL_CURRENCY) {
    throw new AppError(
      `Only ${PLATFORM_INTERNAL_CURRENCY} is supported as internal virtual currency`,
      400,
      "UNSUPPORTED_CURRENCY"
    );
  }

  if (input.betAtomic <= 0n) {
    throw new AppError("betAtomic must be greater than 0", 400, "INVALID_BET_AMOUNT");
  }
  if (input.betAtomic > MAX_GAME_BET_ATOMIC) {
    throw new AppError("betAtomic exceeds max allowed bet of 5000 COINS", 400, "BET_LIMIT_EXCEEDED");
  }

  const active = await getActiveMinesGame(input.userId);
  if (active) {
    return active;
  }

  const existing = await resolveExistingStartRequest(input.userId, input.idempotencyKey);
  if (existing) {
    return existing;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await ensureProvablyFairContext(tx, input.userId);

      if (input.clientSeedOverride) {
        const normalizedSeed = input.clientSeedOverride.trim();
        if (normalizedSeed.length < 8 || normalizedSeed.length > 128) {
          throw new AppError("clientSeed must be between 8 and 128 characters", 400, "INVALID_CLIENT_SEED");
        }

        await tx.provablyFairProfile.update({
          where: { userId: input.userId },
          data: {
            clientSeed: normalizedSeed
          }
        });
      }

      const nonceRows = await tx.$queryRaw<NonceAllocationRow[]>`
        UPDATE "provably_fair_profiles"
        SET nonce = nonce + 1,
            "updatedAt" = NOW()
        WHERE "userId" = ${input.userId}
        RETURNING nonce - 1 AS nonce, "activeSeedId", "clientSeed"
      `;

      const nonceState = nonceRows[0];
      if (!nonceState) {
        throw new AppError("Unable to allocate provably fair nonce", 500, "NONCE_ALLOCATION_FAILED");
      }

      const seed = await tx.provablyFairSeed.findUnique({
        where: {
          id: nonceState.activeSeedId
        }
      });

      if (!seed || seed.status !== "ACTIVE") {
        throw new AppError("Active server seed not found", 500, "ACTIVE_SERVER_SEED_NOT_FOUND");
      }

      const wallet = await debitBalanceInTx(tx, {
        userId: input.userId,
        currency: input.currency,
        amountAtomic: input.betAtomic,
        lockAmountAtomic: input.betAtomic
      });
      await applyWagerXpInTx(tx, input.userId, input.betAtomic);

      const betReference = `mines:${seed.serverSeedHash.slice(0, 12)}:${nonceState.nonce}:${randomUUID()}`;

      const holdEntry = await createMinesLedgerEntry(tx, {
        walletId: wallet.walletId,
        direction: LedgerDirection.DEBIT,
        reason: LedgerReason.BET_HOLD,
        amountAtomic: input.betAtomic,
        balanceBeforeAtomic: wallet.balanceBeforeAtomic,
        balanceAfterAtomic: wallet.balanceAtomic,
        idempotencyKey: input.idempotencyKey,
        referenceId: betReference,
        metadata: {
          game: "MINES",
          operation: "HOLD",
          mineCount: input.mineCount,
          nonce: nonceState.nonce,
          lockedAfterAtomic: wallet.lockedAtomic.toString()
        } as Prisma.InputJsonValue
      });

      const reservation = await tx.betReservation.create({
        data: {
          userId: input.userId,
          walletId: wallet.walletId,
          currency: input.currency,
          betReference,
          amountAtomic: input.betAtomic,
          status: BetReservationStatus.HELD,
          holdIdempotencyKey: input.idempotencyKey,
          holdTransactionId: holdEntry.id,
          metadata: {
            game: "MINES",
            mineCount: input.mineCount
          } as Prisma.InputJsonValue
        }
      });

      const game = await tx.minesGame.create({
        data: {
          userId: input.userId,
          currency: input.currency,
          betAtomic: input.betAtomic,
          mineCount: input.mineCount,
          boardSize: BOARD_SIZE,
          status: MinesGameStatus.ACTIVE,
          serverSeedId: seed.id,
          serverSeedHash: seed.serverSeedHash,
          clientSeed: nonceState.clientSeed,
          nonce: nonceState.nonce,
          betReference,
          betReservationId: reservation.id,
          revealedCells: [],
          safeReveals: 0,
          currentMultiplier: "1.00000000"
        }
      });

      await tx.outboxEvent.create({
        data: {
          type: "MINES_GAME_STARTED",
          payload: {
            userId: input.userId,
            gameId: game.id,
            currency: input.currency,
            betAtomic: input.betAtomic.toString(),
            mineCount: input.mineCount,
            nonce: game.nonce,
            serverSeedHash: game.serverSeedHash
          }
        }
      });

      return {
        game,
        wallet: {
          walletId: wallet.walletId,
          balanceAtomic: wallet.balanceAtomic,
          lockedAtomic: wallet.lockedAtomic
        }
      };
    });

    void enqueueAuditEvent({
      type: "MINES_GAME_STARTED",
      actorId: input.userId,
      targetId: input.userId,
      metadata: {
        gameId: result.game.id,
        currency: result.game.currency,
        betAtomic: result.game.betAtomic.toString(),
        mineCount: result.game.mineCount,
        nonce: result.game.nonce,
        serverSeedHash: result.game.serverSeedHash
      }
    });

    return toMinesGameState(result.game, result.wallet);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const replay = await resolveExistingStartRequest(input.userId, input.idempotencyKey);
      if (replay) {
        return replay;
      }
    }

    throw error;
  }
};

export const getMinesGameById = async (userId: string, gameId: string): Promise<MinesGameState> => {
  const game = await prisma.minesGame.findFirst({
    where: {
      id: gameId,
      userId
    },
    include: {
      betReservation: {
        select: {
          walletId: true
        }
      }
    }
  });

  if (!game || !game.betReservation) {
    throw new AppError("Mines game not found", 404, "MINES_GAME_NOT_FOUND");
  }

  const wallet = await getWalletSnapshotById(game.betReservation.walletId);
  return toMinesGameState(game, wallet);
};

export const getActiveMinesGame = async (userId: string): Promise<MinesGameState | null> => {
  const game = await prisma.minesGame.findFirst({
    where: {
      userId,
      status: MinesGameStatus.ACTIVE,
      finishedAt: null,
      betReservation: {
        is: {
          status: BetReservationStatus.HELD
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    include: {
      betReservation: {
        select: {
          walletId: true,
          status: true
        }
      }
    }
  });

  if (!game || !game.betReservation || game.betReservation.status !== BetReservationStatus.HELD) {
    return null;
  }

  const wallet = await getWalletSnapshotById(game.betReservation.walletId);
  return toMinesGameState(game, wallet);
};

export const revealMinesTile = async (input: RevealTileInput): Promise<MinesRevealResult> => {
  if (!Number.isInteger(input.cellIndex) || input.cellIndex < 0 || input.cellIndex >= BOARD_SIZE) {
    throw new AppError(`cellIndex must be an integer between 0 and ${BOARD_SIZE - 1}`, 400, "INVALID_CELL_INDEX");
  }

  const result = await prisma.$transaction(async (tx) => {
    const game = await lockGameForUpdate(tx, input.gameId, input.userId);

    if (game.status !== MinesGameStatus.ACTIVE) {
      const wallet = await tx.wallet.findUnique({
        where: { id: game.betReservation.walletId },
        select: { id: true, balanceAtomic: true, lockedAtomic: true }
      });

      return {
        state: toMinesGameState(
          game,
          ensureWalletSnapshot(
            wallet
              ? { id: wallet.id, balanceAtomic: wallet.balanceAtomic, lockedAtomic: wallet.lockedAtomic }
              : undefined
          )
        ),
        hitMine: game.status === MinesGameStatus.LOST,
        revealedNow: false,
        gameResolved: true
      };
    }

    const revealedCells = parseRevealedCells(game.revealedCells);
    if (revealedCells.includes(input.cellIndex)) {
      const wallet = await tx.wallet.findUnique({
        where: { id: game.betReservation.walletId },
        select: { id: true, balanceAtomic: true, lockedAtomic: true }
      });

      return {
        state: toMinesGameState(
          game,
          ensureWalletSnapshot(
            wallet
              ? { id: wallet.id, balanceAtomic: wallet.balanceAtomic, lockedAtomic: wallet.lockedAtomic }
              : undefined
          )
        ),
        hitMine: false,
        revealedNow: false,
        gameResolved: false
      };
    }

    const seed = await tx.provablyFairSeed.findUnique({
      where: {
        id: game.serverSeedId
      }
    });

    if (!seed) {
      throw new AppError("Server seed not found for game", 500, "SERVER_SEED_NOT_FOUND");
    }

    const mines = buildMineIndexes(seed.serverSeed, game.clientSeed, game.nonce, game.mineCount, game.boardSize);
    const hitMine = mines.includes(input.cellIndex);

    if (hitMine) {
      const wallet = await captureReservationFunds(
        tx,
        game,
        `mines:${game.id}:reveal:${input.cellIndex}:capture`
      );

      const updatedGame = await tx.minesGame.update({
        where: { id: game.id },
        data: {
          status: MinesGameStatus.LOST,
          finishedAt: new Date()
        }
      });

      await tx.outboxEvent.create({
        data: {
          type: "MINES_GAME_LOST",
          payload: {
            userId: input.userId,
            gameId: game.id,
            mineCell: input.cellIndex,
            nonce: game.nonce,
            serverSeedHash: game.serverSeedHash
          }
        }
      });

      return {
        state: toMinesGameState(updatedGame, wallet),
        hitMine: true,
        revealedNow: true,
        gameResolved: true
      };
    }

    const nextRevealed = [...revealedCells, input.cellIndex].sort((a, b) => a - b);
    const nextSafeReveals = nextRevealed.length;
    const multiplier = calculateMultiplier(game.mineCount, nextSafeReveals, game.boardSize);

    const updatedActive = await tx.minesGame.update({
      where: {
        id: game.id
      },
      data: {
        revealedCells: nextRevealed,
        safeReveals: nextSafeReveals,
        currentMultiplier: multiplier.toFixed(8)
      }
    });

    const hasClearedBoard = nextSafeReveals === game.boardSize - game.mineCount;
    if (!hasClearedBoard) {
      const wallet = await tx.wallet.findUnique({
        where: { id: game.betReservation.walletId },
        select: { id: true, balanceAtomic: true, lockedAtomic: true }
      });

      return {
        state: toMinesGameState(
          updatedActive,
          ensureWalletSnapshot(
            wallet
              ? { id: wallet.id, balanceAtomic: wallet.balanceAtomic, lockedAtomic: wallet.lockedAtomic }
              : undefined
          )
        ),
        hitMine: false,
        revealedNow: true,
        gameResolved: false
      };
    }

    const payoutAtomic = calculatePayoutAtomic(game.betAtomic, multiplier);
    const capturedWallet = await captureReservationFunds(tx, game, `mines:${game.id}:auto-capture`);
    const paidWallet = await creditWalletPayout(
      tx,
      capturedWallet.walletId,
      payoutAtomic,
      `mines:${game.id}:auto-payout`,
      game.betReference,
      game.id
    );

    const finalizedGame = await tx.minesGame.update({
      where: {
        id: game.id
      },
      data: {
        status: MinesGameStatus.CASHED_OUT,
        revealedCells: nextRevealed,
        safeReveals: nextSafeReveals,
        currentMultiplier: multiplier.toFixed(8),
        payoutAtomic,
        finishedAt: new Date()
      }
    });

    await tx.outboxEvent.create({
      data: {
        type: "MINES_GAME_CASHED_OUT",
        payload: {
          userId: input.userId,
          gameId: game.id,
          payoutAtomic: payoutAtomic.toString(),
          auto: true
        }
      }
    });

    return {
      state: toMinesGameState(finalizedGame, paidWallet),
      hitMine: false,
      revealedNow: true,
      gameResolved: true
    };
  });

  if (result.hitMine) {
    void enqueueAuditEvent({
      type: "MINES_GAME_LOST",
      actorId: input.userId,
      targetId: input.userId,
      metadata: {
        gameId: result.state.gameId,
        safeReveals: result.state.safeReveals
      }
    });
  } else if (result.gameResolved) {
    void enqueueAuditEvent({
      type: "MINES_GAME_CASHED_OUT",
      actorId: input.userId,
      targetId: input.userId,
      metadata: {
        gameId: result.state.gameId,
        payoutAtomic: result.state.payoutAtomic?.toString() ?? "0"
      }
    });
  }

  return result;
};

export const cashoutMinesGame = async (input: CashoutInput): Promise<MinesGameState> => {
  const result = await prisma.$transaction(async (tx) => {
    const game = await lockGameForUpdate(tx, input.gameId, input.userId);

    if (game.status === MinesGameStatus.CASHED_OUT) {
      const wallet = await tx.wallet.findUnique({
        where: { id: game.betReservation.walletId },
        select: { id: true, balanceAtomic: true, lockedAtomic: true }
      });

      return toMinesGameState(
        game,
        ensureWalletSnapshot(
          wallet ? { id: wallet.id, balanceAtomic: wallet.balanceAtomic, lockedAtomic: wallet.lockedAtomic } : undefined
        )
      );
    }

    if (game.status === MinesGameStatus.LOST) {
      throw new AppError("Mines game already lost", 409, "MINES_GAME_ALREADY_LOST");
    }

    if (game.safeReveals <= 0) {
      throw new AppError(
        "You must reveal at least one safe tile before cashout",
        409,
        "MINES_CASHOUT_REQUIRES_REVEAL"
      );
    }

    const multiplier = calculateMultiplier(game.mineCount, game.safeReveals, game.boardSize);
    const payoutAtomic = calculatePayoutAtomic(game.betAtomic, multiplier);
    const lockToRelease = game.betReservation.status === BetReservationStatus.HELD ? game.betAtomic : 0n;

    const currentWallet = await tx.wallet.findUnique({
      where: { id: game.betReservation.walletId },
      select: { id: true, balanceAtomic: true, lockedAtomic: true }
    });
    const walletBefore = ensureWalletSnapshot(
      currentWallet
        ? {
            id: currentWallet.id,
            balanceAtomic: currentWallet.balanceAtomic,
            lockedAtomic: currentWallet.lockedAtomic
          }
        : undefined
    );
    const nextLocked = walletBefore.lockedAtomic - lockToRelease;
    if (nextLocked < 0n) {
      throw new AppError("Wallet locked balance is inconsistent", 409, "WALLET_LOCKED_INCONSISTENT");
    }

    const walletUpdated = await tx.wallet.update({
      where: { id: walletBefore.walletId },
      data: {
        balanceAtomic: {
          increment: payoutAtomic
        },
        lockedAtomic: nextLocked,
        updatedAt: new Date()
      },
      select: { id: true, balanceAtomic: true, lockedAtomic: true }
    });
    const wallet = ensureWalletSnapshot({
      id: walletUpdated.id,
      balanceAtomic: walletUpdated.balanceAtomic,
      lockedAtomic: walletUpdated.lockedAtomic
    });

    if (game.betReservation.status === BetReservationStatus.HELD) {
      await tx.betReservation.update({
        where: { id: game.betReservation.id },
        data: {
          status: BetReservationStatus.CAPTURED,
          captureIdempotencyKey: `${input.idempotencyKey}:cashout`,
          capturedAt: new Date()
        }
      });
    }

    const updatedGame = await tx.minesGame.update({
      where: { id: game.id },
      data: {
        status: MinesGameStatus.CASHED_OUT,
        currentMultiplier: multiplier.toFixed(8),
        payoutAtomic,
        finishedAt: new Date()
      }
    });

    return toMinesGameState(updatedGame, wallet);
  });

  void enqueueAuditEvent({
    type: "MINES_GAME_CASHED_OUT",
    actorId: input.userId,
    targetId: input.userId,
    metadata: {
      gameId: result.gameId,
      payoutAtomic: result.payoutAtomic?.toString() ?? "0",
      currentMultiplier: result.currentMultiplier
    }
  });

  return result;
};
