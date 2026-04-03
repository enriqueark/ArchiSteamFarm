import { RouletteBetType } from "@prisma/client";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import { AppError } from "../../core/errors";
import { requireIdempotencyKey } from "../../core/idempotency";
import { PLATFORM_VIRTUAL_COIN_SYMBOL, SUPPORTED_CURRENCIES } from "../wallets/service";
import {
  RouletteBetBreakdownState,
  RouletteRoundState,
  getCurrentRouletteBetBreakdown,
  getCurrentRouletteRound,
  getRouletteBetBreakdownByRoundId,
  getRouletteRoundById,
  listRecentRouletteResults,
  listUserRouletteBets,
  placeRouletteBet,
  setRouletteBroadcaster,
  startRouletteRoundWorker,
  stopRouletteRoundWorker
} from "./service";
import { ROULETTE_ALLOWED_BET_TYPES } from "./rules";
import { RouletteWebsocketHub } from "./ws-hub";
import { PLATFORM_INTERNAL_CURRENCY } from "../wallets/service";

const websocketHub = new RouletteWebsocketHub();
const toCoinsString = (atomic: bigint): string => (Number(atomic) / 1e8).toFixed(2);

const currentRoundQuerySchema = z.object({
  currency: z.literal(PLATFORM_INTERNAL_CURRENCY)
});

const websocketQuerySchema = z.object({
  currency: z.literal(PLATFORM_INTERNAL_CURRENCY).optional()
});

const placeBetSchema = z.object({
  currency: z.literal(PLATFORM_INTERNAL_CURRENCY),
  roundId: z.string().cuid().optional(),
  betType: z
    .nativeEnum(RouletteBetType)
    .refine(
      (value) => (ROULETTE_ALLOWED_BET_TYPES as readonly RouletteBetType[]).includes(value),
      "betType must be RED, BLACK, GREEN or BAIT"
    ),
  stakeAtomic: z
    .string()
    .regex(/^\d+$/, "stakeAtomic must be an integer string")
    .transform((value) => BigInt(value))
    .refine((value) => value > 0n, "stakeAtomic must be greater than 0")
});

const roundParamsSchema = z.object({
  roundId: z.string().cuid()
});

const listMyBetsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

const recentResultsQuerySchema = z.object({
  currency: z.literal(PLATFORM_INTERNAL_CURRENCY),
  limit: z.coerce.number().int().min(1).max(20).default(20)
});

const ensureIdempotencyKey = (request: { idempotencyKey?: string }): string => {
  if (!request.idempotencyKey) {
    throw new AppError("Idempotency-Key header is required", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }

  return request.idempotencyKey;
};

const toRoundResponse = (round: RouletteRoundState) => ({
  id: round.id,
  roundNumber: round.roundNumber,
  currency: PLATFORM_VIRTUAL_COIN_SYMBOL,
  status: round.status,
  openAt: round.openAt,
  betsCloseAt: round.betsCloseAt,
  spinStartsAt: round.spinStartsAt,
  settleAt: round.settleAt,
  winningNumber: round.winningNumber,
  winningColor: round.winningColor,
  totalStakedAtomic: round.totalStakedAtomic.toString(),
  totalPayoutAtomic: round.totalPayoutAtomic.toString()
});

const toRoundWsEvent = (round: RouletteRoundState) => ({
  type: "roulette.round",
  data: {
    roundId: round.id,
    roundNumber: round.roundNumber,
    currency: PLATFORM_VIRTUAL_COIN_SYMBOL,
    status: round.status,
    openAt: round.openAt.toISOString(),
    betsCloseAt: round.betsCloseAt.toISOString(),
    spinStartsAt: round.spinStartsAt.toISOString(),
    settleAt: round.settleAt.toISOString(),
    winningNumber: round.winningNumber,
    winningColor: round.winningColor,
    totalStakedAtomic: round.totalStakedAtomic.toString(),
    totalPayoutAtomic: round.totalPayoutAtomic.toString()
  }
});

const toBetBreakdownResponse = (state: RouletteBetBreakdownState) => ({
  roundId: state.roundId,
  roundNumber: state.roundNumber,
  currency: PLATFORM_VIRTUAL_COIN_SYMBOL,
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
});

export const rouletteRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onReady", async () => {
    websocketHub.start();
    setRouletteBroadcaster(websocketHub);
    await startRouletteRoundWorker(fastify.log);
  });

  fastify.addHook("onClose", async () => {
    stopRouletteRoundWorker();
    setRouletteBroadcaster(null);
    websocketHub.stop();
  });

  fastify.get("/ws", { websocket: true }, (socket, request) => {
    const parsed = websocketQuerySchema.safeParse(request.query);
    const currencyFilter = parsed.success ? parsed.data.currency : undefined;

    websocketHub.attachClient(socket, currencyFilter);

    void (async () => {
      const currencies = currencyFilter ? [currencyFilter] : SUPPORTED_CURRENCIES;
      for (const currency of currencies) {
        const round = await getCurrentRouletteRound(currency);
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(toRoundWsEvent(round)));
          const breakdown = await getCurrentRouletteBetBreakdown(currency);
          socket.send(
            JSON.stringify({
              type: "roulette.betBreakdown",
              data: toBetBreakdownResponse(breakdown)
            })
          );
        }
      }
    })();
  });

  fastify.get("/rounds/current", async (request, reply) => {
    const query = currentRoundQuerySchema.parse(request.query);
    const round = await getCurrentRouletteRound(query.currency);
    return reply.send(toRoundResponse(round));
  });

  fastify.get("/rounds/:roundId", async (request, reply) => {
    const params = roundParamsSchema.parse(request.params);
    const round = await getRouletteRoundById(params.roundId);
    return reply.send(toRoundResponse(round));
  });

  fastify.get("/rounds/current/breakdown", async (request, reply) => {
    const query = currentRoundQuerySchema.parse(request.query);
    const breakdown = await getCurrentRouletteBetBreakdown(query.currency);
    return reply.send(toBetBreakdownResponse(breakdown));
  });

  fastify.get("/rounds/:roundId/breakdown", async (request, reply) => {
    const params = roundParamsSchema.parse(request.params);
    const breakdown = await getRouletteBetBreakdownByRoundId(params.roundId);
    return reply.send(toBetBreakdownResponse(breakdown));
  });

  fastify.get("/results", async (request, reply) => {
    const query = recentResultsQuerySchema.parse(request.query);
    const results = await listRecentRouletteResults(query.currency, query.limit);
    return reply.send(
      results.map((result) => ({
        roundId: result.roundId,
        roundNumber: result.roundNumber,
        currency: PLATFORM_VIRTUAL_COIN_SYMBOL,
        winningNumber: result.winningNumber,
        winningColor: result.winningColor,
        totalStakedAtomic: result.totalStakedAtomic.toString(),
        totalPayoutAtomic: result.totalPayoutAtomic.toString(),
        settledAt: result.settledAt
      }))
    );
  });

  fastify.post(
    "/bets",
    {
      preHandler: [requireAuth, requireIdempotencyKey]
    },
    async (request, reply) => {
      const body = placeBetSchema.parse(request.body);
      const result = await placeRouletteBet({
        userId: request.user.sub,
        currency: body.currency,
        roundId: body.roundId,
        betType: body.betType,
        stakeAtomic: body.stakeAtomic,
        idempotencyKey: ensureIdempotencyKey(request)
      });

      return reply.code(201).send({
        round: toRoundResponse(result.round),
        bet: {
          id: result.bet.id,
          roundId: result.bet.roundId,
          currency: PLATFORM_VIRTUAL_COIN_SYMBOL,
          betType: result.bet.betType,
          betValue: result.bet.betValue,
          stakeAtomic: result.bet.stakeAtomic.toString(),
          payoutAtomic: result.bet.payoutAtomic?.toString() ?? null,
          status: result.bet.status,
          createdAt: result.bet.createdAt,
          settledAt: result.bet.settledAt
        },
        wallet: {
          walletId: result.wallet.walletId,
          balanceAtomic: result.wallet.balanceAtomic.toString(),
          balanceCoins: toCoinsString(result.wallet.balanceAtomic),
          lockedAtomic: result.wallet.lockedAtomic.toString(),
          lockedCoins: toCoinsString(result.wallet.lockedAtomic),
          availableAtomic: (result.wallet.balanceAtomic - result.wallet.lockedAtomic).toString()
          ,
          availableCoins: toCoinsString(result.wallet.balanceAtomic - result.wallet.lockedAtomic)
        }
      });
    }
  );

  fastify.get("/bets/me", { preHandler: requireAuth }, async (request, reply) => {
    const query = listMyBetsQuerySchema.parse(request.query);
    const bets = await listUserRouletteBets(request.user.sub, query.limit);

    return reply.send(
      bets.map((bet) => ({
        id: bet.id,
        roundId: bet.roundId,
        currency: PLATFORM_VIRTUAL_COIN_SYMBOL,
        betType: bet.betType,
        betValue: bet.betValue,
        stakeAtomic: bet.stakeAtomic.toString(),
        payoutAtomic: bet.payoutAtomic?.toString() ?? null,
        status: bet.status,
        createdAt: bet.createdAt,
        settledAt: bet.settledAt
      }))
    );
  });
};
