import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import { requireIdempotencyKey } from "../../core/idempotency";
import { getRouletteBroadcaster } from "../roulette/service";
import { getCurrentRainState, joinRain, tipRain, tipUser, type RainRoundState } from "./service";

const userTipSchema = z.object({
  toUserPublicId: z.coerce.number().int().min(1),
  amountCoins: z.coerce.number().min(1).max(1_000_000),
  message: z.string().trim().max(120).optional(),
  silent: z.coerce.boolean().optional()
});

const rainTipSchema = z.object({
  amountCoins: z.coerce.number().min(1).max(1_000_000)
});

const toRainResponse = (state: RainRoundState) => ({
  roundId: state.id,
  startsAt: state.startsAt,
  endsAt: state.endsAt,
  baseAmountAtomic: state.baseAmountAtomic.toString(),
  tippedAmountAtomic: state.tippedAmountAtomic.toString(),
  totalAmountAtomic: state.totalAmountAtomic.toString(),
  joinedCount: state.participantCount,
  hasJoined: state.hasJoined
});

export const chatTipsRainRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/rain/current", { preHandler: requireAuth }, async (request, reply) => {
    const state = await getCurrentRainState(request.user.sub);
    return reply.send(toRainResponse(state));
  });

  fastify.post(
    "/rain/join",
    {
      preHandler: [requireAuth, requireIdempotencyKey]
    },
    async (request, reply) => {
      const state = await joinRain(request.user.sub);
      const broadcaster = getRouletteBroadcaster();
      broadcaster?.broadcast({
        type: "rain.joined",
        data: {
          roundId: state.id,
          userId: request.user.sub,
          joinedCount: state.participantCount
        }
      });
      return reply.send(toRainResponse(state));
    }
  );

  fastify.post(
    "/rain/tip",
    {
      preHandler: [requireAuth, requireIdempotencyKey]
    },
    async (request, reply) => {
      const body = rainTipSchema.parse(request.body);
      const result = await tipRain({
        fromUserId: request.user.sub,
        amountCoins: body.amountCoins
      });
      const broadcaster = getRouletteBroadcaster();
      broadcaster?.broadcast({
        type: "rain.tipped",
        data: {
          roundId: result.rain.id,
          userId: request.user.sub,
          amountAtomic: result.tip.amountAtomic.toString(),
          tippedAmountAtomic: result.rain.tippedAmountAtomic.toString(),
          totalAmountAtomic: result.rain.totalAmountAtomic.toString()
        }
      });
      return reply.send({
        rain: toRainResponse(result.rain),
        tip: {
          id: result.tip.id,
          amountAtomic: result.tip.amountAtomic.toString(),
          createdAt: result.tip.createdAt
        }
      });
    }
  );

  fastify.post(
    "/tips",
    {
      preHandler: [requireAuth, requireIdempotencyKey]
    },
    async (request, reply) => {
      const body = userTipSchema.parse(request.body);
      const result = await tipUser({
        fromUserId: request.user.sub,
        toUserPublicId: body.toUserPublicId,
        amountCoins: body.amountCoins,
        message: body.message,
        silent: body.silent,
        actorRole: request.user.role
      });
      const broadcaster = getRouletteBroadcaster();
      const shouldBroadcastTipMessage =
        !result.silent || request.user.role === "ADMIN" || request.user.role === "SUPPORT";
      if (shouldBroadcastTipMessage) {
        broadcaster?.broadcast({
          type: "chat.userTip",
          data: {
            id: result.id,
            fromUserId: result.fromUserId,
            fromUserPublicId: result.fromUserPublicId,
            fromUserLabel: result.fromUserLabel,
            toUserId: result.toUserId,
            toUserPublicId: result.toUserPublicId,
            toUserLabel: result.toUserLabel,
            amountAtomic: result.amountAtomic,
            message: result.message,
            createdAt: result.createdAt.toISOString()
          }
        });
      }
      return reply.send(result);
    }
  );
};
