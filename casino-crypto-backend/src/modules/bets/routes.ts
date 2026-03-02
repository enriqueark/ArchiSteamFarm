import { Currency } from "@prisma/client";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireRoles } from "../../core/auth";
import { AppError } from "../../core/errors";
import { requireIdempotencyKey } from "../../core/idempotency";
import { placeBet, settleBet } from "./service";

const placeBetSchema = z.object({
  userId: z.string().cuid(),
  currency: z.nativeEnum(Currency),
  gameType: z.string().min(2).max(64),
  roundReference: z.string().min(4).max(128),
  multiplier: z.string().regex(/^\d+(\.\d{1,8})?$/, "multiplier must be a decimal string"),
  amountAtomic: z
    .string()
    .regex(/^\d+$/, "amountAtomic must be an integer string")
    .transform((value) => BigInt(value))
    .refine((value) => value > 0n, "amountAtomic must be greater than 0")
});

const settleBetSchema = z.object({
  gameResult: z.enum(["WON", "LOST"])
});

const betParamsSchema = z.object({
  betId: z.string().cuid()
});

const ensureIdempotencyKey = (request: { idempotencyKey?: string }): string => {
  if (!request.idempotencyKey) {
    throw new AppError("Idempotency-Key header is required", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }

  return request.idempotencyKey;
};

export const betsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/place",
    {
      preHandler: [requireRoles(["ADMIN"]), requireIdempotencyKey]
    },
    async (request, reply) => {
      const body = placeBetSchema.parse(request.body);
      const result = await placeBet({
        userId: body.userId,
        currency: body.currency,
        gameType: body.gameType,
        roundReference: body.roundReference,
        multiplier: body.multiplier,
        amountAtomic: body.amountAtomic,
        placeIdempotencyKey: ensureIdempotencyKey(request)
      });

      return reply.code(201).send({
        betId: result.betId,
        status: result.status,
        balanceBefore: result.balanceBefore.toString(),
        balanceAfter: result.balanceAfter.toString(),
        lockedAfter: result.lockedAfter.toString()
      });
    }
  );

  fastify.post(
    "/:betId/settle",
    {
      preHandler: [requireRoles(["ADMIN"])]
    },
    async (request, reply) => {
      const params = betParamsSchema.parse(request.params);
      const body = settleBetSchema.parse(request.body);

      const result = await settleBet({
        betId: params.betId,
        gameResult: body.gameResult
      });

      return reply.send({
        betId: result.betId,
        status: result.status,
        payoutAtomic: result.payoutAtomic.toString(),
        balanceBefore: result.balanceBefore.toString(),
        balanceAfter: result.balanceAfter.toString(),
        lockedAfter: result.lockedAfter.toString()
      });
    }
  );
};
