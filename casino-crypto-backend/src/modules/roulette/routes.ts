import { Currency, RouletteBetType } from "@prisma/client";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import { AppError } from "../../core/errors";
import { requireIdempotencyKey } from "../../core/idempotency";
import { SUPPORTED_CURRENCIES } from "../wallets/service";
import { getRouletteProbabilityModel } from "./rules";
import {
  RouletteRoundState,
  getCurrentRouletteRound,
  getRouletteRoundById,
  listUserRouletteBets,
  placeRouletteBet,
  setRouletteBroadcaster,
  startRouletteRoundWorker,
  stopRouletteRoundWorker
} from "./service";
import { RouletteWebsocketHub } from "./ws-hub";

const websocketHub = new RouletteWebsocketHub();

const currentRoundQuerySchema = z.object({
  currency: z.nativeEnum(Currency)
});

const websocketQuerySchema = z.object({
  currency: z.nativeEnum(Currency).optional()
});

const placeBetSchema = z.object({
  currency: z.nativeEnum(Currency),
  roundId: z.string().cuid().optional(),
  betType: z.nativeEnum(RouletteBetType),
  betValue: z.number().int().optional(),
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

const ensureIdempotencyKey = (request: { idempotencyKey?: string }): string => {
  if (!request.idempotencyKey) {
    throw new AppError("Idempotency-Key header is required", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }

  return request.idempotencyKey;
};

const toRoundResponse = (round: RouletteRoundState) => ({
  id: round.id,
  roundNumber: round.roundNumber,
  currency: round.currency,
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
  payload: {
    roundId: round.id,
    roundNumber: round.roundNumber,
    currency: round.currency,
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
        }
      }
    })();
  });

  fastify.get("/rounds/current", async (request, reply) => {
    const query = currentRoundQuerySchema.parse(request.query);
    const round = await getCurrentRouletteRound(query.currency);
    return reply.send(toRoundResponse(round));
  });

  fastify.get("/probability-model", async (_request, reply) => reply.send(getRouletteProbabilityModel()));

  fastify.get("/rounds/:roundId", async (request, reply) => {
    const params = roundParamsSchema.parse(request.params);
    const round = await getRouletteRoundById(params.roundId);
    return reply.send(toRoundResponse(round));
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
        betValue: body.betValue,
        stakeAtomic: body.stakeAtomic,
        idempotencyKey: ensureIdempotencyKey(request)
      });

      return reply.code(201).send({
        round: toRoundResponse(result.round),
        bet: {
          id: result.bet.id,
          roundId: result.bet.roundId,
          currency: result.bet.currency,
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
          lockedAtomic: result.wallet.lockedAtomic.toString(),
          availableAtomic: result.wallet.balanceAtomic.toString()
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
        currency: bet.currency,
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
