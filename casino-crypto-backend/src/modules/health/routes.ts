import { FastifyPluginAsync } from "fastify";

import { ensureRedisConnections, redis } from "../../infrastructure/redis/client";
import { prisma } from "../../infrastructure/db/prisma";

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/live", async (_request, reply) => {
    return reply.send({
      status: "ok",
      service: "casino-crypto-backend",
      timestamp: new Date().toISOString()
    });
  });

  fastify.get("/ready", async (_request, reply) => {
    const checks = {
      postgres: false,
      redis: false
    };

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.postgres = true;
    } catch {
      checks.postgres = false;
    }

    try {
      await ensureRedisConnections();
      const pong = await redis.ping();
      checks.redis = pong === "PONG";
    } catch {
      checks.redis = false;
    }

    const ready = checks.postgres && checks.redis;
    return reply.code(ready ? 200 : 503).send({
      status: ready ? "ready" : "degraded",
      checks,
      timestamp: new Date().toISOString()
    });
  });
};
