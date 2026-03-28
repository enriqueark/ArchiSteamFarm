import { FastifyPluginAsync } from "fastify";

import { requireAuth } from "../../core/auth";
import { prisma } from "../../infrastructure/db/prisma";
import { getLevelFromXp } from "../progression/service";

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma
      .$queryRaw<
        Array<{
          id: string;
          email: string;
          role: "PLAYER" | "ADMIN" | "SUPPORT";
          status: "ACTIVE" | "SUSPENDED";
          createdAt: Date;
          levelXpAtomic: bigint;
        }>
      >`
      SELECT
        id,
        email,
        role,
        status,
        "createdAt",
        COALESCE("levelXpAtomic", 0) AS "levelXpAtomic"
      FROM "users"
      WHERE id = ${request.user.sub}
      LIMIT 1
    `
      .then((rows) => rows[0]);

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
