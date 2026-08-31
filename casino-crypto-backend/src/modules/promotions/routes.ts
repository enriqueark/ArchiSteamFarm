import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth, requireRoles } from "../../core/auth";
import {
  applyDepositBonusCode,
  createPromoCodeByAdmin,
  getDepositBonusStatus,
  getWithdrawWagerRemainingAtomic,
  listPromoCodesByAdmin,
  redeemPromoCode,
  setWithdrawWagerRemainingAtomicByAdmin
} from "./service";

const redeemPromoSchema = z.object({
  code: z.string().trim().min(3).max(32)
});

const applyBonusCodeSchema = z.object({
  code: z.string().trim().min(3).max(20)
});

const adminCreatePromoSchema = z
  .object({
    code: z.string().trim().min(3).max(32),
    usageLimit: z.coerce.number().int().min(1).max(1_000_000),
    rewardAtomic: z
      .string()
      .trim()
      .regex(/^\d+$/, "rewardAtomic must be an integer string")
      .optional(),
    rewardCoins: z.coerce.number().positive().max(1_000_000).optional()
  })
  .refine((value) => Boolean(value.rewardAtomic) || typeof value.rewardCoins === "number", {
    message: "Provide rewardAtomic or rewardCoins",
    path: ["rewardAtomic"]
  });

const adminListPromoQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  q: z.string().trim().max(60).optional(),
  onlyActive: z.coerce.boolean().default(false)
});

const adminSetUserWagerParamsSchema = z.object({
  userId: z.string().cuid()
});

const adminSetUserWagerBodySchema = z
  .object({
    remainingAtomic: z
      .string()
      .trim()
      .regex(/^\d+$/, "remainingAtomic must be an integer string")
      .optional(),
    remainingCoins: z.coerce.number().min(0).max(1_000_000_000).optional()
  })
  .refine((value) => Boolean(value.remainingAtomic) || typeof value.remainingCoins === "number", {
    message: "Provide remainingAtomic or remainingCoins",
    path: ["remainingAtomic"]
  });

const coinsToAtomic = (coins: number): bigint => BigInt(Math.round(coins * 1e8));

export const promotionsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/promo-codes/redeem", { preHandler: requireAuth }, async (request, reply) => {
    const body = redeemPromoSchema.parse(request.body);
    const redeemed = await redeemPromoCode({
      userId: request.user.sub,
      code: body.code
    });
    return reply.send(redeemed);
  });

  fastify.post("/deposit-bonus/apply", { preHandler: requireAuth }, async (request, reply) => {
    const body = applyBonusCodeSchema.parse(request.body);
    const applied = await applyDepositBonusCode({
      userId: request.user.sub,
      code: body.code
    });
    return reply.send(applied);
  });

  fastify.get("/deposit-bonus/status", { preHandler: requireAuth }, async (request, reply) => {
    const [status, withdrawWagerRemainingAtomic] = await Promise.all([
      getDepositBonusStatus(request.user.sub),
      getWithdrawWagerRemainingAtomic(request.user.sub)
    ]);
    return reply.send({
      ...status,
      withdrawWagerRemainingAtomic: withdrawWagerRemainingAtomic.toString()
    });
  });

  fastify.get("/admin/promo-codes", { preHandler: [requireRoles(["ADMIN"])] }, async (request, reply) => {
    const query = adminListPromoQuerySchema.parse(request.query);
    const rows = await listPromoCodesByAdmin(query);
    return reply.send(rows);
  });

  fastify.post("/admin/promo-codes", { preHandler: [requireRoles(["ADMIN"])] }, async (request, reply) => {
    const body = adminCreatePromoSchema.parse(request.body);
    const rewardAtomic =
      typeof body.rewardAtomic === "string" && body.rewardAtomic.trim().length > 0
        ? BigInt(body.rewardAtomic)
        : coinsToAtomic(body.rewardCoins ?? 0);
    const created = await createPromoCodeByAdmin({
      actorUserId: request.user.sub,
      code: body.code,
      usageLimit: body.usageLimit,
      rewardAtomic
    });
    return reply.code(201).send(created);
  });

  fastify.patch(
    "/admin/users/:userId/withdraw-wager",
    { preHandler: [requireRoles(["ADMIN"])] },
    async (request, reply) => {
      const params = adminSetUserWagerParamsSchema.parse(request.params);
      const body = adminSetUserWagerBodySchema.parse(request.body);
      const remainingAtomic =
        typeof body.remainingAtomic === "string" && body.remainingAtomic.trim().length > 0
          ? BigInt(body.remainingAtomic)
          : coinsToAtomic(body.remainingCoins ?? 0);
      const updated = await setWithdrawWagerRemainingAtomicByAdmin(params.userId, remainingAtomic);
      return reply.send({
        userId: updated.userId,
        remainingAtomic: updated.remainingAtomic.toString(),
        remainingCoins: updated.remainingCoins,
        currency: "COINS",
        canWithdrawNow: updated.remainingAtomic <= 0n
      });
    }
  );
};
