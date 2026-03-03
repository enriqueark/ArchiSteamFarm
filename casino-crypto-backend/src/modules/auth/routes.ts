import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import { AppError } from "../../core/errors";
import { login, logout, refreshSession, register } from "./service";

const credentialSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(30)
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/register", async (request, reply) => {
    const body = credentialSchema.parse(request.body);
    const result = await register(fastify, {
      ...body,
      userAgent: request.headers["user-agent"],
      ipAddress: request.ip
    });

    return reply.code(201).send(result);
  });

  fastify.post("/login", async (request, reply) => {
    const body = credentialSchema.parse(request.body);
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
