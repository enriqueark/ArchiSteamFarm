import { Currency } from "@prisma/client";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth, requireRoles } from "../../core/auth";
import { AppError } from "../../core/errors";
import { requireIdempotencyKey } from "../../core/idempotency";
import { prisma } from "../../infrastructure/db/prisma";
import { captureHeldFunds, holdFundsForBet, releaseHeldFunds } from "./bet-reservation.service";
import { getWalletsByUser } from "./service";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

const holdSchema = z.object({
  userId: z.string().cuid(),
  currency: z.nativeEnum(Currency),
  betReference: z.string().min(8).max(128),
  amountAtomic: z
    .string()
    .regex(/^\d+$/, "amountAtomic must be an integer string")
    .transform((value) => BigInt(value))
    .refine((value) => value > 0n, "amountAtomic must be greater than 0"),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const finalizeSchema = z.object({
  userId: z.string().cuid(),
  currency: z.nativeEnum(Currency),
  betReference: z.string().min(8).max(128)
});

const getIdempotencyKey = (request: { idempotencyKey?: string }): string => {
  if (!request.idempotencyKey) {
    throw new AppError("Idempotency-Key header is required", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }

  return request.idempotencyKey;
};

export const walletRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", { preHandler: requireAuth }, async (request, reply) => {
    const wallets = await getWalletsByUser(request.user.sub);

    return reply.send(
      wallets.map((wallet) => ({
        id: wallet.id,
        currency: wallet.currency,
        balanceAtomic: wallet.balanceAtomic.toString(),
        lockedAtomic: wallet.lockedAtomic.toString(),
        updatedAt: wallet.updatedAt
      }))
    );
  });

  fastify.get("/:currency/entries", { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ currency: z.nativeEnum(Currency) }).parse(request.params);
    const query = querySchema.parse(request.query);

    const wallet = await prisma.wallet.findUnique({
      where: {
        userId_currency: {
          userId: request.user.sub,
          currency: params.currency
        }
      },
      select: {
        id: true
      }
    });

    if (!wallet) {
      throw new AppError("Wallet not found for requested currency", 404, "WALLET_NOT_FOUND");
    }

    const entries = await prisma.ledgerEntry.findMany({
      where: {
        walletId: wallet.id
      },
      orderBy: {
        createdAt: "desc"
      },
      take: query.limit
    });

    return reply.send(
      entries.map((entry) => ({
        id: entry.id,
        direction: entry.direction,
        reason: entry.reason,
        amountAtomic: entry.amountAtomic.toString(),
        balanceBeforeAtomic: entry.balanceBeforeAtomic.toString(),
        balanceAfterAtomic: entry.balanceAfterAtomic.toString(),
        referenceId: entry.referenceId,
        idempotencyKey: entry.idempotencyKey,
        metadata: entry.metadata,
        createdAt: entry.createdAt
      }))
    );
  });

  fastify.post(
    "/admin/bets/hold",
    {
      preHandler: [requireRoles(["ADMIN"]), requireIdempotencyKey]
    },
    async (request, reply) => {
      const body = holdSchema.parse(request.body);
      const idempotencyKey = getIdempotencyKey(request);
      const result = await holdFundsForBet({
        actorUserId: request.user.sub,
        userId: body.userId,
        currency: body.currency,
        betReference: body.betReference,
        amountAtomic: body.amountAtomic,
        idempotencyKey,
        metadata: body.metadata
      });

      return reply.send({
        reservationId: result.reservation.id,
        status: result.reservation.status,
        betReference: result.reservation.betReference,
        amountAtomic: result.reservation.amountAtomic.toString(),
        currency: result.reservation.currency,
        holdTransactionId: result.reservation.holdTransactionId,
        releaseTransactionId: result.reservation.releaseTransactionId,
        captureTransactionId: result.reservation.captureTransactionId,
        balanceAtomic: result.wallet.balanceAtomic.toString(),
        lockedAtomic: result.wallet.lockedAtomic.toString(),
        availableAtomic: result.wallet.balanceAtomic.toString()
      });
    }
  );

  fastify.post(
    "/admin/bets/release",
    {
      preHandler: [requireRoles(["ADMIN"]), requireIdempotencyKey]
    },
    async (request, reply) => {
      const body = finalizeSchema.parse(request.body);
      const idempotencyKey = getIdempotencyKey(request);
      const result = await releaseHeldFunds({
        actorUserId: request.user.sub,
        userId: body.userId,
        currency: body.currency,
        betReference: body.betReference,
        idempotencyKey
      });

      return reply.send({
        reservationId: result.reservation.id,
        status: result.reservation.status,
        betReference: result.reservation.betReference,
        amountAtomic: result.reservation.amountAtomic.toString(),
        currency: result.reservation.currency,
        holdTransactionId: result.reservation.holdTransactionId,
        releaseTransactionId: result.reservation.releaseTransactionId,
        captureTransactionId: result.reservation.captureTransactionId,
        balanceAtomic: result.wallet.balanceAtomic.toString(),
        lockedAtomic: result.wallet.lockedAtomic.toString(),
        availableAtomic: result.wallet.balanceAtomic.toString()
      });
    }
  );

  fastify.post(
    "/admin/bets/capture",
    {
      preHandler: [requireRoles(["ADMIN"]), requireIdempotencyKey]
    },
    async (request, reply) => {
      const body = finalizeSchema.parse(request.body);
      const idempotencyKey = getIdempotencyKey(request);
      const result = await captureHeldFunds({
        actorUserId: request.user.sub,
        userId: body.userId,
        currency: body.currency,
        betReference: body.betReference,
        idempotencyKey
      });

      return reply.send({
        reservationId: result.reservation.id,
        status: result.reservation.status,
        betReference: result.reservation.betReference,
        amountAtomic: result.reservation.amountAtomic.toString(),
        currency: result.reservation.currency,
        holdTransactionId: result.reservation.holdTransactionId,
        releaseTransactionId: result.reservation.releaseTransactionId,
        captureTransactionId: result.reservation.captureTransactionId,
        balanceAtomic: result.wallet.balanceAtomic.toString(),
        lockedAtomic: result.wallet.lockedAtomic.toString(),
        availableAtomic: result.wallet.balanceAtomic.toString()
      });
    }
  );
};
