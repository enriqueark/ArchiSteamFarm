import { Currency } from "@prisma/client";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import { AppError, isAppError } from "../../core/errors";
import { requireIdempotencyKey } from "../../core/idempotency";
import {
  cashoutMinesGame,
  getActiveMinesGame,
  getMinesGameById,
  type MinesGameState,
  getOrCreateProvablyFairState,
  revealMinesTile,
  rotateProvablyFairServerSeed,
  setProvablyFairClientSeed,
  startMinesGame
} from "./service";

const startGameSchema = z.object({
  currency: z.nativeEnum(Currency),
  betAtomic: z
    .string()
    .regex(/^\d+$/, "betAtomic must be an integer string")
    .transform((value) => BigInt(value))
    .refine((value) => value > 0n, "betAtomic must be greater than 0"),
  mineCount: z.number().int().min(1).max(24),
  clientSeed: z.string().min(8).max(128).optional()
});

const revealSchema = z.object({
  cellIndex: z.number().int().min(0).max(24)
});

const clientSeedSchema = z.object({
  clientSeed: z.string().min(8).max(128)
});

const gameParamsSchema = z.object({
  gameId: z.string().cuid()
});

const toGameResponse = (result: MinesGameState) => ({
  gameId: result.gameId,
  status: result.status,
  currency: result.currency,
  betAtomic: result.betAtomic.toString(),
  mineCount: result.mineCount,
  boardSize: result.boardSize,
  safeReveals: result.safeReveals,
  revealedCells: result.revealedCells,
  currentMultiplier: result.currentMultiplier.toFixed(8),
  potentialPayoutAtomic: result.potentialPayoutAtomic.toString(),
  payoutAtomic: result.payoutAtomic?.toString() ?? null,
  provablyFair: {
    serverSeedHash: result.provablyFair.serverSeedHash,
    clientSeed: result.provablyFair.clientSeed,
    nonce: result.provablyFair.nonce
  },
  wallet: {
    walletId: result.wallet.walletId,
    balanceAtomic: result.wallet.balanceAtomic.toString(),
    lockedAtomic: result.wallet.lockedAtomic.toString(),
    availableAtomic: result.wallet.balanceAtomic.toString()
  },
  createdAt: result.createdAt,
  finishedAt: result.finishedAt
});

const ensureIdempotencyKey = (request: { idempotencyKey?: string }): string => {
  if (!request.idempotencyKey) {
    throw new AppError("Idempotency-Key header is required", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }

  return request.idempotencyKey;
};

export const minesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/provably-fair", { preHandler: requireAuth }, async (request, reply) => {
    const state = await getOrCreateProvablyFairState(request.user.sub);

    return reply.send({
      clientSeed: state.clientSeed,
      nonce: state.nonce,
      activeServerSeedHash: state.activeServerSeedHash,
      revealedSeeds: state.revealedSeeds.map((seed) => ({
        id: seed.id,
        serverSeed: seed.serverSeed,
        serverSeedHash: seed.serverSeedHash,
        createdAt: seed.createdAt,
        revealedAt: seed.revealedAt
      }))
    });
  });

  fastify.put("/provably-fair/client-seed", { preHandler: requireAuth }, async (request, reply) => {
    const body = clientSeedSchema.parse(request.body);
    const updated = await setProvablyFairClientSeed(request.user.sub, body.clientSeed);

    return reply.send(updated);
  });

  fastify.post("/provably-fair/rotate", { preHandler: requireAuth }, async (request, reply) => {
    const result = await rotateProvablyFairServerSeed(request.user.sub);
    return reply.send(result);
  });

  fastify.post(
    "/games",
    {
      preHandler: [requireAuth, requireIdempotencyKey]
    },
    async (request, reply) => {
      const body = startGameSchema.parse(request.body);
      const result = await startMinesGame({
        userId: request.user.sub,
        currency: body.currency,
        betAtomic: body.betAtomic,
        mineCount: body.mineCount,
        idempotencyKey: ensureIdempotencyKey(request),
        clientSeedOverride: body.clientSeed
      });

      return reply.code(201).send(toGameResponse(result));
    }
  );

  fastify.get("/games/active", { preHandler: requireAuth }, async (request, reply) => {
    const result = await getActiveMinesGame(request.user.sub);
    return reply.send(result ? toGameResponse(result) : null);
  });

  fastify.get("/games/:gameId", { preHandler: requireAuth }, async (request, reply) => {
    const params = gameParamsSchema.parse(request.params);
    const result = await getMinesGameById(request.user.sub, params.gameId);
    return reply.send(toGameResponse(result));
  });

  fastify.post("/games/:gameId/reveal", { preHandler: requireAuth }, async (request, reply) => {
    const params = gameParamsSchema.parse(request.params);
    const body = revealSchema.parse(request.body);
    const result = await revealMinesTile({
      userId: request.user.sub,
      gameId: params.gameId,
      cellIndex: body.cellIndex
    });

    return reply.send({
      ...toGameResponse(result.state),
      reveal: {
        cellIndex: body.cellIndex,
        hitMine: result.hitMine,
        revealedNow: result.revealedNow,
        gameResolved: result.gameResolved
      }
    });
  });

  fastify.post(
    "/games/:gameId/cashout",
    {
      preHandler: [requireAuth, requireIdempotencyKey]
    },
    async (request, reply) => {
      const params = gameParamsSchema.parse(request.params);
      try {
        const result = await cashoutMinesGame({
          userId: request.user.sub,
          gameId: params.gameId,
          idempotencyKey: ensureIdempotencyKey(request)
        });

        return reply.send(toGameResponse(result));
      } catch (error) {
        if (isAppError(error)) {
          throw error;
        }

        request.log.error({ err: error, gameId: params.gameId, userId: request.user.sub }, "Mines cashout failed");
        return reply.code(500).send({
          code: "MINES_CASHOUT_INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Cashout failed"
        });
      }
    }
  );
};
