import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

import { env } from "./config/env";
import { isAppError, toZodDetails } from "./core/errors";
import { redis } from "./infrastructure/cache/redis";
import { authRoutes } from "./modules/auth/routes";
import { healthRoutes } from "./modules/health/routes";
import { ledgerRoutes } from "./modules/ledger/routes";
import { userRoutes } from "./modules/users/routes";
import { walletRoutes } from "./modules/wallets/routes";

export const buildApp = (): FastifyInstance => {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL
    },
    trustProxy: true,
    requestIdHeader: "x-request-id",
    genReqId: (request) => (request.headers["x-request-id"] as string | undefined) ?? randomUUID()
  });

  app.register(sensible);
  app.register(cors, {
    origin: true,
    credentials: true
  });
  app.register(helmet);

  app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET
  });
  app.register(jwt, {
    secret: env.JWT_REFRESH_SECRET,
    namespace: "refresh"
  });

  app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: `${env.RATE_LIMIT_WINDOW_SECONDS} seconds`,
    redis
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: "Casino Crypto Backend API",
        description: "API base modular (sin juegos) para plataforma casino crypto.",
        version: "1.0.0"
      },
      tags: [
        { name: "health", description: "Health checks" },
        { name: "auth", description: "Autenticación y sesiones" },
        { name: "wallets", description: "Gestión de wallets" },
        { name: "ledger", description: "Movimientos contables" },
        { name: "users", description: "Perfil de usuario" }
      ]
    }
  });

  app.register(swaggerUi, {
    routePrefix: "/docs"
  });

  app.register(healthRoutes, { prefix: "/api/v1/health" });
  app.register(authRoutes, { prefix: "/api/v1/auth" });
  app.register(userRoutes, { prefix: "/api/v1/users" });
  app.register(walletRoutes, { prefix: "/api/v1/wallets" });
  app.register(ledgerRoutes, { prefix: "/api/v1/ledger" });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_ERROR",
        message: "Error de validación",
        details: toZodDetails(error)
      });
    }

    if (isAppError(error)) {
      return reply.code(error.statusCode).send({
        code: error.code,
        message: error.message,
        details: error.details
      });
    }

    request.log.error({ err: error }, "Unhandled error");
    return reply.code(500).send({
      code: "INTERNAL_SERVER_ERROR",
      message: "Ha ocurrido un error interno"
    });
  });

  app.addHook("onReady", async () => {
    if (redis.status === "wait") {
      await redis.connect();
    }
  });

  return app;
};
