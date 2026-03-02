import { FastifyPluginAsync } from "fastify";

import { requireAuth } from "../../core/auth";
import { prisma } from "../../infrastructure/db/prisma";

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
        createdAt: true
      }
    });

    if (!user) {
      return reply.code(404).send({ message: "Usuario no encontrado" });
    }

    return reply.send(user);
  });
};
