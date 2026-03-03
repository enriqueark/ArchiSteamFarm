import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";
import Fastify, { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

import { env } from "./config/env";
import { isAppError, toZodDetails } from "./core/errors";
import { redis } from "./infrastructure/cache/redis";
import { authRoutes } from "./modules/auth/routes";
import { betsRoutes } from "./modules/bets/routes";
import { healthRoutes } from "./modules/health/routes";
import { ledgerRoutes } from "./modules/ledger/routes";
import { minesRoutes } from "./modules/mines/routes";
import { rouletteRoutes } from "./modules/roulette/routes";
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
  app.register(websocket, {
    options: {
      perMessageDeflate: false,
      maxPayload: 1024 * 8
    }
  });

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
        description: "Modular base API (without games) for a crypto casino platform.",
        version: "1.0.0"
      },
      tags: [
        { name: "health", description: "Health checks" },
        { name: "auth", description: "Authentication and sessions" },
        { name: "bets", description: "Transactional generic bet placement and settlement" },
        { name: "wallets", description: "Wallet management and bet reservations" },
        { name: "ledger", description: "Ledger accounting entries" },
        { name: "mines", description: "Mines game with provably fair backend generation" },
        { name: "roulette", description: "Roulette rounds with websocket realtime updates" },
        { name: "users", description: "User profile" }
      ]
    }
  });

  app.register(swaggerUi, {
    routePrefix: "/docs"
  });

  app.register(healthRoutes, { prefix: "/api/v1/health" });
  app.register(authRoutes, { prefix: "/api/v1/auth" });
  app.register(betsRoutes, { prefix: "/api/v1/bets" });
  app.register(userRoutes, { prefix: "/api/v1/users" });
  app.register(walletRoutes, { prefix: "/api/v1/wallets" });
  app.register(ledgerRoutes, { prefix: "/api/v1/ledger" });
  app.register(minesRoutes, { prefix: "/api/v1/mines" });
  app.register(rouletteRoutes, { prefix: "/api/v1/roulette" });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_ERROR",
        message: "Validation error",
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
      message: "An internal error occurred"
    });
  });

  app.addHook("onReady", async () => {
    if (redis.status === "wait") {
      await redis.connect();
    }
  });

  return app;
};
