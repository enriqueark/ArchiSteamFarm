import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import { AppError } from "../../core/errors";
import { requireIdempotencyKey } from "../../core/idempotency";
import { PLATFORM_INTERNAL_CURRENCY, PLATFORM_VIRTUAL_COIN_SYMBOL } from "../wallets/service";
import {
  actOnBlackjackGame,
  getActiveBlackjackGame,
  getBlackjackGameById,
  getOrCreateActiveBlackjackGame
} from "./service";

const startGameSchema = z.object({
  currency: z.literal(PLATFORM_INTERNAL_CURRENCY),
  betAtomic: z
    .string()
    .regex(/^\d+$/, "betAtomic must be an integer string")
    .transform((value) => BigInt(value))
    .refine((value) => value >= 20_000_000n, "betAtomic must be at least 0.2"),
  sideBetPairsAtomic: z
    .string()
    .regex(/^\d+$/, "sideBetPairsAtomic must be an integer string")
    .transform((value) => BigInt(value))
    .optional(),
  sideBet21Plus3Atomic: z
    .string()
    .regex(/^\d+$/, "sideBet21Plus3Atomic must be an integer string")
    .transform((value) => BigInt(value))
    .optional()
});

const actionSchema = z.object({
  action: z.enum(["HIT", "STAND", "DOUBLE", "SPLIT", "INSURANCE"])
});

const gameParamsSchema = z.object({
  gameId: z.string().cuid()
});

const ensureIdempotencyKey = (request: { idempotencyKey?: string }): string => {
  if (!request.idempotencyKey) {
    throw new AppError("Idempotency-Key header is required", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }
  return request.idempotencyKey;
};

const toGameResponse = (state: Awaited<ReturnType<typeof getBlackjackGameById>>) => ({
  gameId: state.gameId,
  status: state.status,
  currency: PLATFORM_VIRTUAL_COIN_SYMBOL,
  initialBetAtomic: state.initialBetAtomic.toString(),
  initialBetCoins: (Number(state.initialBetAtomic) / 1e8).toFixed(2),
  mainBetAtomic: state.mainBetAtomic.toString(),
  mainBetCoins: (Number(state.mainBetAtomic) / 1e8).toFixed(2),
  sideBetPairsAtomic: state.sideBetPairsAtomic.toString(),
  sideBetPairsCoins: (Number(state.sideBetPairsAtomic) / 1e8).toFixed(2),
  sideBet21Plus3Atomic: state.sideBet21Plus3Atomic.toString(),
  sideBet21Plus3Coins: (Number(state.sideBet21Plus3Atomic) / 1e8).toFixed(2),
  insuranceBetAtomic: state.insuranceBetAtomic?.toString() ?? null,
  insuranceBetCoins:
    state.insuranceBetAtomic !== null && state.insuranceBetAtomic !== undefined
      ? (Number(state.insuranceBetAtomic) / 1e8).toFixed(2)
      : null,
  canSplit: state.canSplit,
  canInsurance: state.canInsurance,
  activeHandIndex: state.activeHandIndex,
  dealerRevealed: state.dealerRevealed,
  playerHands: state.playerHands.map((hand) => ({
    cards: hand.cards,
    stakeAtomic: hand.stakeAtomic.toString(),
    stakeCoins: (Number(hand.stakeAtomic) / 1e8).toFixed(2),
    doubled: hand.doubled,
    stood: hand.stood,
    busted: hand.busted,
    blackjack: hand.blackjack,
    value: hand.value
  })),
  dealerCards: state.dealerCards,
  dealerVisibleCards: state.dealerVisibleCards,
  paytable: state.paytable,
  provablyFair: state.provablyFair,
  payoutAtomic: state.payoutAtomic?.toString() ?? null,
  payoutCoins:
    state.payoutAtomic !== null && state.payoutAtomic !== undefined
      ? (Number(state.payoutAtomic) / 1e8).toFixed(2)
      : null,
  createdAt: state.createdAt,
  finishedAt: state.finishedAt,
  wallet: {
    walletId: state.wallet.walletId,
    balanceAtomic: state.wallet.balanceAtomic.toString(),
    balanceCoins: (Number(state.wallet.balanceAtomic) / 1e8).toFixed(2),
    lockedAtomic: state.wallet.lockedAtomic.toString(),
    lockedCoins: (Number(state.wallet.lockedAtomic) / 1e8).toFixed(2),
    availableAtomic: (state.wallet.balanceAtomic - state.wallet.lockedAtomic).toString(),
    availableCoins: (Number(state.wallet.balanceAtomic - state.wallet.lockedAtomic) / 1e8).toFixed(2)
  }
});

export const blackjackRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/games",
    {
      preHandler: [requireAuth, requireIdempotencyKey]
    },
    async (request, reply) => {
      const body = startGameSchema.parse(request.body);
      const created = await getOrCreateActiveBlackjackGame({
        userId: request.user.sub,
        currency: body.currency,
        betAtomic: body.betAtomic,
        sideBetPairsAtomic: body.sideBetPairsAtomic,
        sideBet21Plus3Atomic: body.sideBet21Plus3Atomic,
        idempotencyKey: ensureIdempotencyKey(request)
      });
      return reply.code(201).send(toGameResponse(created.state));
    }
  );

  fastify.get("/games/active", { preHandler: requireAuth }, async (request, reply) => {
    const active = await getActiveBlackjackGame(request.user.sub);
    return reply.send(active ? toGameResponse(active) : null);
  });

  fastify.get("/games/:gameId", { preHandler: requireAuth }, async (request, reply) => {
    const params = gameParamsSchema.parse(request.params);
    const game = await getBlackjackGameById(request.user.sub, params.gameId);
    return reply.send(toGameResponse(game));
  });

  fastify.post(
    "/games/:gameId/action",
    {
      preHandler: [requireAuth, requireIdempotencyKey]
    },
    async (request, reply) => {
      const params = gameParamsSchema.parse(request.params);
      const body = actionSchema.parse(request.body);
      const game = await actOnBlackjackGame({
        userId: request.user.sub,
        gameId: params.gameId,
        action: body.action,
        idempotencyKey: ensureIdempotencyKey(request)
      });
      return reply.send(toGameResponse(game));
    }
  );
};
