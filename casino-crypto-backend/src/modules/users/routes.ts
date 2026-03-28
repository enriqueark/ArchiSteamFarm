import { FastifyPluginAsync } from "fastify";

import { requireAuth } from "../../core/auth";
import { prisma } from "../../infrastructure/db/prisma";
import { getLevelFromXp } from "../progression/service";

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: {
        id: request.user.sub
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        levelXpAtomic: true,
        createdAt: true
      }
    });

    if (!user) {
      return reply.code(404).send({ message: "User not found" });
    }

    const level = getLevelFromXp(user.levelXpAtomic);

    return reply.send({
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      level,
      levelXpAtomic: user.levelXpAtomic.toString(),
      progression: {
        level,
        xpAtomic: user.levelXpAtomic.toString()
      }
    });
  });
};
