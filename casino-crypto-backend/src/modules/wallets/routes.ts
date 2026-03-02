import { Currency } from "@prisma/client";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";
import { getWalletsByUser } from "./service";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

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
      throw new AppError("Wallet no encontrada para la moneda solicitada", 404, "WALLET_NOT_FOUND");
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
};
