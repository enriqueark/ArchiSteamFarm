import { FastifyPluginAsync } from "fastify";

import { requireAuth } from "../../core/auth";
import { prisma } from "../../infrastructure/db/prisma";
import { getLevelFromXp } from "../progression/service";

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user
      .findUnique({
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
      })
      .catch((error) => {
        // Backward compatible fallback for deployments where levelXpAtomic
        // column is not present yet.
        if (
          error instanceof Error &&
          (error.message.includes("levelXpAtomic") ||
            error.message.includes("users.levelXpAtomic") ||
            error.message.includes("column"))
        ) {
          return prisma.user.findUnique({
            where: {
              id: request.user.sub
            },
            select: {
              id: true,
              email: true,
              role: true,
              status: true,
              createdAt: true
            }
          });
        }
        throw error;
      });

    if (!user) {
      return reply.code(404).send({ message: "User not found" });
    }

    const xpAtomic = "levelXpAtomic" in user ? user.levelXpAtomic : 0n;
    const level = getLevelFromXp(xpAtomic);

    return reply.send({
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      level,
      levelXpAtomic: xpAtomic.toString(),
      progression: {
        level,
        xpAtomic: xpAtomic.toString()
      }
    });
  });
};
