import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import { requireIdempotencyKey } from "../../core/idempotency";
import {
  depositToVault,
  getVaultState,
  withdrawFromVault
} from "./service";

const amountSchema = z.object({
  amountCoins: z
    .number()
    .finite()
    .positive()
    .transform((value) => BigInt(Math.round(value * 1e8)))
    .refine((value) => value > 0n, "Amount must be greater than 0")
});

const lockDurationSchema = z.enum(["1H", "1D", "3D", "7D"]);

const depositSchema = z.object({
  amountCoins: z.coerce.number().finite().positive(),
  lockDuration: lockDurationSchema.optional()
});

const withdrawSchema = z.object({
  amountCoins: z.coerce.number().finite().positive()
});

export const vaultRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", { preHandler: requireAuth }, async (request, reply) => {
    const state = await getVaultState(request.user.sub);
    return reply.send(state);
  });

  fastify.post(
    "/deposit",
    { preHandler: [requireAuth, requireIdempotencyKey] },
    async (request, reply) => {
      const body = depositSchema.parse(request.body);
      const amountAtomic = amountSchema.parse({ amountCoins: body.amountCoins }).amountCoins;
      const state = await depositToVault({
        userId: request.user.sub,
        amountAtomic,
        lockDuration: body.lockDuration,
        idempotencyKey: request.idempotencyKey as string
      });
      return reply.send(state);
    }
  );

  fastify.post(
    "/withdraw",
    { preHandler: [requireAuth, requireIdempotencyKey] },
    async (request, reply) => {
      const body = withdrawSchema.parse(request.body);
      const amountAtomic = amountSchema.parse({ amountCoins: body.amountCoins }).amountCoins;
      const state = await withdrawFromVault({
        userId: request.user.sub,
        amountAtomic,
        idempotencyKey: request.idempotencyKey as string
      });
      return reply.send(state);
    }
  );
};
