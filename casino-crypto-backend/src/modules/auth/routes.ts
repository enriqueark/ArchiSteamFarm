import { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import { AppError } from "../../core/errors";
import { login, logout, refreshSession, register } from "./service";

const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128)
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(128),
  twoFactorCode: z.string().trim().regex(/^\d{6}$/).optional()
});

const refreshSchema = z.object({
  refreshToken: z.string().min(30)
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Backward-compat endpoint for clients that request an auth nonce before login/register.
  fastify.get("/nonce", async (_request, reply) => {
    return reply.send({
      nonce: randomUUID()
    });
  });

  fastify.post("/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const result = await register(fastify, {
      ...body,
      userAgent: request.headers["user-agent"],
      ipAddress: request.ip
    });

    return reply.code(201).send(result);
  });

  fastify.post("/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await login(fastify, {
      ...body,
      userAgent: request.headers["user-agent"],
      ipAddress: request.ip
    });

    return reply.send(result);
  });

  fastify.post("/refresh", async (request, reply) => {
    const body = refreshSchema.parse(request.body);
    const tokens = await refreshSession(fastify, body.refreshToken, request.headers["user-agent"], request.ip);

    return reply.send(tokens);
  });

  fastify.post("/logout", { preHandler: requireAuth }, async (request, reply) => {
    if (!request.user.sessionId) {
      throw new AppError("Invalid session", 401, "INVALID_SESSION");
    }

    await logout(request.user.sessionId, request.user.sub);
    return reply.code(204).send();
  });
};
