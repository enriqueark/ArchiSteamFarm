import { Currency, LedgerReason } from "@prisma/client";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireRoles } from "../../core/auth";
import { requireIdempotencyKey } from "../../core/idempotency";
import { adjustWalletBalance } from "./service";

const adjustSchema = z.object({
  userId: z.string().cuid(),
  currency: z.nativeEnum(Currency),
  amountAtomic: z
    .string()
    .regex(/^-?\d+$/, "amountAtomic must be an integer string")
    .transform((value) => BigInt(value)),
  reason: z
    .nativeEnum(LedgerReason)
    .default(LedgerReason.ADMIN_ADJUSTMENT)
    .refine(
      (value) =>
        value !== LedgerReason.BET_HOLD &&
        value !== LedgerReason.BET_RELEASE &&
        value !== LedgerReason.BET_CAPTURE,
      {
      message: "Reason is not allowed in this administrative endpoint"
      }
    ),
  referenceId: z.string().max(64).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const ledgerRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/admin/adjust",
    {
      preHandler: [requireRoles(["ADMIN"]), requireIdempotencyKey]
    },
    async (request, reply) => {
      const body = adjustSchema.parse(request.body);

      const result = await adjustWalletBalance({
        actorUserId: request.user.sub,
        userId: body.userId,
        currency: body.currency,
        amountAtomic: body.amountAtomic,
        reason: body.reason,
        idempotencyKey: request.idempotencyKey,
        metadata: body.metadata,
        referenceId: body.referenceId
      });

      return reply.send({
        entry: {
          id: result.entry.id,
          walletId: result.entry.walletId,
          direction: result.entry.direction,
          reason: result.entry.reason,
          amountAtomic: result.entry.amountAtomic.toString(),
          balanceBeforeAtomic: result.entry.balanceBeforeAtomic.toString(),
          balanceAfterAtomic: result.entry.balanceAfterAtomic.toString(),
          referenceId: result.entry.referenceId,
          idempotencyKey: result.entry.idempotencyKey,
          createdAt: result.entry.createdAt
        },
        balanceAtomic: result.balanceAtomic.toString()
      });
    }
  );
};
