import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { prisma } from "../../infrastructure/db/prisma";
import { getLevelFromXp } from "../progression/service";
import { PLATFORM_INTERNAL_CURRENCY } from "../wallets/service";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const toLabel = (email: string, publicId: number | null): string => {
  const local = email.split("@")[0]?.trim();
  if (local && local.length) {
    return local.slice(0, 24);
  }
  if (publicId && Number.isInteger(publicId)) {
    return `user#${publicId}`;
  }
  return "player";
};

export const leaderboardRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (request, reply) => {
    const query = querySchema.parse(request.query);
    const rows = await prisma.user.findMany({
      where: {
        role: "PLAYER",
        status: "ACTIVE"
      },
      orderBy: [{ levelXpAtomic: "desc" }, { createdAt: "asc" }],
      take: query.limit,
      select: {
        id: true,
        publicId: true,
        email: true,
        levelXpAtomic: true,
        createdAt: true,
        wallets: {
          where: { currency: PLATFORM_INTERNAL_CURRENCY },
          select: {
            balanceAtomic: true
          },
          take: 1
        }
      }
    });

    return reply.send({
      rows: rows.map((row, idx) => ({
        rank: idx + 1,
        userId: row.id,
        publicId: row.publicId ?? null,
        userLabel: toLabel(row.email, row.publicId ?? null),
        level: getLevelFromXp(row.levelXpAtomic),
        levelXpAtomic: row.levelXpAtomic.toString(),
        balanceAtomic: (row.wallets[0]?.balanceAtomic ?? 0n).toString(),
        createdAt: row.createdAt
      }))
    });
  });
};
