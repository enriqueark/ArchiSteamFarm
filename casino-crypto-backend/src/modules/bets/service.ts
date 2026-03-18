import {
  CasinoBet,
  CasinoBetStatus,
  Currency,
  GameResultOutcome,
  LedgerDirection,
  LedgerReason,
  Prisma
} from "@prisma/client";
import { KeyObject, createHash, createPublicKey, verify } from "node:crypto";

import { env } from "../../config/env";
import { AppError } from "../../core/errors";
import { GAME_ENGINE_SERVICE_ROLE } from "../../core/service-auth";
import { prisma } from "../../infrastructure/db/prisma";
import { enqueueAuditEvent } from "../../infrastructure/queue/audit-queue";

type PlaceBetInput = {
  userId: string;
  currency: Currency;
  gameType: string;
  roundReference: string;
  amountAtomic: bigint;
  multiplier: string;
  placeIdempotencyKey: string;
};

type SettlementActor = {
  actorUserId?: string;
  serviceRole?: string;
};

type SignedGameResult = {
  gameResult: "WON" | "LOST";
  issuedAt: string;
  nonce: string;
  signature: string;
};

type SettleBetInput = {
  betId: string;
  actor: SettlementActor;
  signedGameResult: SignedGameResult;
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
const BIGINT_MAX = 9_223_372_036_854_775_807n;
const MAX_CLOCK_SKEW_MS = 5_000;
const ED25519_SIGNATURE_SIZE_BYTES = 64;
const SIGNATURE_VERSION = "ED25519_V1";
const BASE64_SIGNATURE_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64URL_SIGNATURE_REGEX = /^[A-Za-z0-9_-]+$/;

let gameEnginePublicKeyCache: KeyObject | null = null;

const isSerializationConflict = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";

const isUniqueViolation = (error: unknown): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const getGameEnginePublicKey = (): KeyObject => {
  if (gameEnginePublicKeyCache) {
    return gameEnginePublicKeyCache;
  }

  const rawKey = env.GAME_ENGINE_PUBLIC_KEY.trim();
  const normalizedKey = rawKey.replace(/\\n/g, "\n");

  try {
    if (normalizedKey.includes("BEGIN PUBLIC KEY")) {
      gameEnginePublicKeyCache = createPublicKey(normalizedKey);
      return gameEnginePublicKeyCache;
    }

    if (!BASE64_SIGNATURE_REGEX.test(normalizedKey)) {
      throw new Error("Invalid base64 key encoding");
    }

    const der = Buffer.from(normalizedKey, "base64");
    if (der.length < 32) {
      throw new Error("DER key payload is too short");
    }

    gameEnginePublicKeyCache = createPublicKey({
      key: der,
      format: "der",
      type: "spki"
    });

    return gameEnginePublicKeyCache;
  } catch {
    throw new AppError(
      "Invalid GAME_ENGINE_PUBLIC_KEY configuration",
      500,
      "ENGINE_PUBLIC_KEY_INVALID"
    );
  }
};

const parseSignature = (signature: string): Buffer => {
  const normalized = signature.trim();
  if (!normalized) {
    throw new AppError("Signed game result signature is missing", 400, "GAME_RESULT_SIGNATURE_INVALID");
  }

  let decoded: Buffer;
  if (BASE64URL_SIGNATURE_REGEX.test(normalized)) {
    decoded = Buffer.from(normalized, "base64url");
  } else if (BASE64_SIGNATURE_REGEX.test(normalized)) {
    decoded = Buffer.from(normalized, "base64");
  } else {
    throw new AppError(
      "Signed game result signature must be base64 or base64url",
      400,
      "GAME_RESULT_SIGNATURE_INVALID"
    );
  }

  if (decoded.length !== ED25519_SIGNATURE_SIZE_BYTES) {
    throw new AppError("Invalid Ed25519 signature length", 400, "GAME_RESULT_SIGNATURE_INVALID");
  }

  return decoded;
};

const parseMultiplier = (rawMultiplier: string): Prisma.Decimal => {
  const normalized = rawMultiplier.trim();

  if (!/^\d+(\.\d{1,8})?$/.test(normalized)) {
    throw new AppError("multiplier must be a decimal string with up to 8 fractional digits", 400, "INVALID_MULTIPLIER");
  }

  const multiplier = new Prisma.Decimal(normalized);
  if (multiplier.lte(0)) {
    throw new AppError("multiplier must be greater than 0", 400, "INVALID_MULTIPLIER");
  }

  if (multiplier.gt(new Prisma.Decimal("1000"))) {
    throw new AppError("multiplier is unreasonably large", 400, "INVALID_MULTIPLIER");
  }

  return multiplier;
};

const calculatePayoutAtomic = (amountAtomic: bigint, multiplier: Prisma.Decimal): bigint => {
  const payoutDecimal = new Prisma.Decimal(amountAtomic.toString()).mul(multiplier);
  return BigInt(payoutDecimal.toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN).toFixed(0));
};

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

const getBetByPlaceKey = async (userId: string, placeIdempotencyKey: string) =>
  prisma.casinoBet.findUnique({
    where: {
      userId_placeIdempotencyKey: {
        userId,
        placeIdempotencyKey
      }
    }
  });

const assertActorCanSettle = (actor: SettlementActor, betUserId: string): void => {
  if (actor.serviceRole === GAME_ENGINE_SERVICE_ROLE) {
    return;
  }

  // Ownership check for user-level actor paths, even though settlement remains service-only.
  if (actor.actorUserId && actor.actorUserId !== betUserId) {
    throw new AppError("Bet does not belong to settlement actor", 403, "BET_USER_MISMATCH");
  }

  throw new AppError("Only GAME_ENGINE service role can settle bets", 403, "SERVICE_ROLE_FORBIDDEN");
};

const parseIssuedAt = (issuedAtIso: string): Date => {
  const issuedAt = new Date(issuedAtIso);
  if (Number.isNaN(issuedAt.getTime())) {
    throw new AppError("Invalid signed result timestamp", 400, "INVALID_RESULT_TIMESTAMP");
  }

  const now = Date.now();
  const drift = now - issuedAt.getTime();
  if (drift < -MAX_CLOCK_SKEW_MS) {
    throw new AppError("Signed result timestamp is in the future", 400, "INVALID_RESULT_TIMESTAMP");
  }

  if (drift > env.GAME_RESULT_SIGNATURE_MAX_AGE_SECONDS * 1000) {
    throw new AppError("Signed result payload has expired", 400, "RESULT_SIGNATURE_EXPIRED");
  }

  return issuedAt;
};

const buildSignedPayload = (
  bet: Pick<CasinoBet, "id" | "gameType" | "roundReference">,
  signedResult: SignedGameResult
): string =>
  [
    bet.id,
    bet.gameType,
    bet.roundReference,
    signedResult.gameResult,
    signedResult.issuedAt,
    signedResult.nonce
  ].join("|");

const verifySignedResultPayload = (
  bet: Pick<CasinoBet, "id" | "gameType" | "roundReference">,
  signedResult: SignedGameResult
): { payload: string; payloadHash: string; issuedAt: Date } => {
  const issuedAt = parseIssuedAt(signedResult.issuedAt);
  const payload = buildSignedPayload(bet, signedResult);
  const signature = parseSignature(signedResult.signature);
  const isVerified = verify(null, Buffer.from(payload), getGameEnginePublicKey(), signature);

  if (!isVerified) {
    throw new AppError("Signed game result verification failed", 403, "GAME_RESULT_SIGNATURE_INVALID");
  }

  const payloadHash = createHash("sha256").update(payload).digest("hex");
  return { payload, payloadHash, issuedAt };
};

const mapGameResultOutcome = (result: SignedGameResult["gameResult"]): GameResultOutcome =>
  result === "WON" ? GameResultOutcome.WON : GameResultOutcome.LOST;

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

  const multiplier = parseMultiplier(input.multiplier);

  const existing = await getBetByPlaceKey(input.userId, input.placeIdempotencyKey);
  if (existing) {
    return toPlaceResult(
      existing,
      existing.placeBalanceBeforeAtomic,
      existing.placeBalanceAfterAtomic,
      existing.placeLockedAfterAtomic
    );
  }

  try {
    const result = await runSerializable(async (tx) => {
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
          multiplier,
          placeBalanceBeforeAtomic: balanceBefore,
          placeBalanceAfterAtomic: balanceAfter,
          placeLockedAfterAtomic: lockedAfter,
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
        return toPlaceResult(
          replay,
          replay.placeBalanceBeforeAtomic,
          replay.placeBalanceAfterAtomic,
          replay.placeLockedAfterAtomic
        );
      }
    }

    throw error;
  }
};

export const settleBet = async (input: SettleBetInput): Promise<SettleBetResult> => {
  try {
    const result = await runSerializable(async (tx) => {
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

      assertActorCanSettle(input.actor, bet.userId);

      const { payloadHash, issuedAt } = verifySignedResultPayload(
        {
          id: bet.id,
          gameType: bet.gameType,
          roundReference: bet.roundReference
        },
        input.signedGameResult
      );

      const settleKey = `engine:${input.signedGameResult.nonce}`;
      if (bet.status !== CasinoBetStatus.PENDING) {
        if (
          bet.settleIdempotencyKey === settleKey &&
          bet.settleBalanceBeforeAtomic !== null &&
          bet.settleBalanceAfterAtomic !== null &&
          bet.settleLockedAfterAtomic !== null
        ) {
          return toSettleResult(
            bet,
            bet.payoutAtomic ?? 0n,
            bet.settleBalanceBeforeAtomic,
            bet.settleBalanceAfterAtomic,
            bet.settleLockedAfterAtomic
          );
        }

        throw new AppError("Bet is already settled", 409, "BET_ALREADY_SETTLED");
      }

      if (bet.amountAtomic <= 0n) {
        throw new AppError("Invalid bet amount persisted in database", 409, "BET_AMOUNT_INVALID");
      }

      const existingValidatedResult = await tx.betGameResult.findUnique({
        where: {
          betId: bet.id
        }
      });

      if (existingValidatedResult) {
        if (
          existingValidatedResult.decisionNonce !== input.signedGameResult.nonce ||
          existingValidatedResult.gameResult !== mapGameResultOutcome(input.signedGameResult.gameResult) ||
          existingValidatedResult.payloadHash !== payloadHash
        ) {
          throw new AppError("Conflicting validated game result for bet", 409, "GAME_RESULT_CONFLICT");
        }
      } else {
        try {
          await tx.betGameResult.create({
            data: {
              betId: bet.id,
              gameResult: mapGameResultOutcome(input.signedGameResult.gameResult),
              decisionNonce: input.signedGameResult.nonce,
              issuedAt,
              signature: input.signedGameResult.signature,
              signatureVersion: SIGNATURE_VERSION,
              payloadHash,
              createdByServiceRole: input.actor.serviceRole ?? "UNKNOWN"
            }
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new AppError("Replay detected for signed game result payload", 409, "RESULT_REPLAY_DETECTED");
          }

          throw error;
        }
      }

      // Financial hardening:
      // payout is computed from persisted stake and multiplier only.
      // Caller cannot provide payout, removing over-credit vectors via API tampering.
      const computedPayout =
        input.signedGameResult.gameResult === "WON" ? calculatePayoutAtomic(bet.amountAtomic, bet.multiplier) : 0n;

      if (computedPayout < 0n || computedPayout > BIGINT_MAX) {
        throw new AppError("Computed payout out of supported range", 409, "PAYOUT_OUT_OF_RANGE");
      }

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

      if (wallet.balanceAtomic > BIGINT_MAX - computedPayout) {
        throw new AppError("Balance overflow prevented during settlement", 409, "BALANCE_OVERFLOW_PREVENTED");
      }

      // CAS-like status transition under lock; concurrent settles cannot both succeed.
      const transitioned = await tx.casinoBet.updateMany({
        where: {
          id: bet.id,
          status: CasinoBetStatus.PENDING
        },
        data: {
          status: input.signedGameResult.gameResult === "WON" ? CasinoBetStatus.WON : CasinoBetStatus.LOST,
          payoutAtomic: computedPayout,
          settleIdempotencyKey: settleKey,
          settledAt: new Date()
        }
      });

      if (transitioned.count === 0) {
        throw new AppError("Bet is already settled", 409, "BET_ALREADY_SETTLED");
      }

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
          idempotencyKey: `${settleKey}:capture`,
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
      if (computedPayout > 0n) {
        balanceAfter = wallet.balanceAtomic + computedPayout;

        const payoutEntry = await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            direction: LedgerDirection.CREDIT,
            reason: LedgerReason.BET_PAYOUT,
            amountAtomic: computedPayout,
            balanceBeforeAtomic: wallet.balanceAtomic,
            balanceAfterAtomic: balanceAfter,
            idempotencyKey: `${settleKey}:payout`,
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
          captureTransactionId: captureEntry.id,
          payoutTransactionId: payoutEntryId,
          settleBalanceBeforeAtomic: wallet.balanceAtomic,
          settleBalanceAfterAtomic: balanceAfter,
          settleLockedAfterAtomic: lockedAfter
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
      actorId: input.actor.actorUserId ?? input.actor.serviceRole ?? "UNKNOWN",
      targetId: result.betId,
      metadata: {
        betId: result.betId,
        result: input.signedGameResult.gameResult,
        payoutAtomic: result.payoutAtomic.toString(),
        balanceBefore: result.balanceBefore.toString(),
        balanceAfter: result.balanceAfter.toString(),
        lockedAfter: result.lockedAfter.toString()
      }
    }).catch(() => undefined);

    return result;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("Replay or duplicate settlement detected", 409, "RESULT_REPLAY_DETECTED");
    }

    throw error;
  }
};
