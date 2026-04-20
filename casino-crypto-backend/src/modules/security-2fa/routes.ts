import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import {
  beginTwoFactorSetup,
  disableTwoFactor,
  getTwoFactorState,
  verifyTwoFactorSetup
} from "./service";

const verifySchema = z.object({
  code: z.string().trim().min(6).max(8)
});

const disableSchema = z.object({
  code: z.string().trim().min(6).max(8)
});

export const securityTwoFactorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", { preHandler: requireAuth }, async (request, reply) => {
    const state = await getTwoFactorState(request.user.sub);
    return reply.send(state);
  });

  fastify.post("/setup", { preHandler: requireAuth }, async (request, reply) => {
    const setup = await beginTwoFactorSetup(request.user.sub);
    return reply.send(setup);
  });

  fastify.post("/verify", { preHandler: requireAuth }, async (request, reply) => {
    const body = verifySchema.parse(request.body);
    const result = await verifyTwoFactorSetup(request.user.sub, body.code);
    return reply.send(result);
  });

  fastify.post("/disable", { preHandler: requireAuth }, async (request, reply) => {
    const body = disableSchema.parse(request.body);
    const result = await disableTwoFactor(request.user.sub, body.code);
    return reply.send(result);
  });
};

