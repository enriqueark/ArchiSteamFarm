import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import { AppError } from "../../core/errors";
import { requireIdempotencyKey } from "../../core/idempotency";
import {
  applyAffiliateCode,
  claimAffiliateCommission,
  getAffiliateDashboard,
  getProfileSummary,
  saveAffiliateCode,
  setProfileVisibility
} from "./service";
import {
  getOrCreateProvablyFairState,
  rotateProvablyFairServerSeed,
  setProvablyFairClientSeed
} from "../mines/service";

const affiliateCodeSchema = z.object({
  code: z.string().min(3).max(20)
});

const profileVisibilitySchema = z.object({
  profileVisible: z.boolean()
});

const clientSeedSchema = z.object({
  clientSeed: z.string().min(8).max(128)
});

const getIdempotencyKey = (request: { idempotencyKey?: string }): string => {
  if (!request.idempotencyKey) {
    throw new AppError("Idempotency-Key header is required", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }
  return request.idempotencyKey;
};

export const affiliatesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/profile/summary", { preHandler: requireAuth }, async (request, reply) => {
    const summary = await getProfileSummary(request.user.sub);
    return reply.send(summary);
  });

  fastify.patch("/profile/visibility", { preHandler: requireAuth }, async (request, reply) => {
    const body = profileVisibilitySchema.parse(request.body);
    const updated = await setProfileVisibility(request.user.sub, body.profileVisible);
    return reply.send({
      profileVisible: updated.profileVisible,
      updatedAt: updated.updatedAt
    });
  });

  fastify.get("/affiliates/dashboard", { preHandler: requireAuth }, async (request, reply) => {
    const dashboard = await getAffiliateDashboard(request.user.sub);
    return reply.send(dashboard);
  });

  fastify.put("/affiliates/code", { preHandler: requireAuth }, async (request, reply) => {
    const body = affiliateCodeSchema.parse(request.body);
    const saved = await saveAffiliateCode(request.user.sub, body.code);
    return reply.send(saved);
  });

  fastify.post("/affiliates/apply", { preHandler: requireAuth }, async (request, reply) => {
    const body = affiliateCodeSchema.parse(request.body);
    const applied = await applyAffiliateCode(request.user.sub, body.code);
    return reply.send(applied);
  });

  fastify.post(
    "/affiliates/claim",
    { preHandler: [requireAuth, requireIdempotencyKey] },
    async (request, reply) => {
      const claimed = await claimAffiliateCommission(request.user.sub, getIdempotencyKey(request));
      return reply.send(claimed);
    }
  );

  fastify.get("/fairness", { preHandler: requireAuth }, async (request, reply) => {
    const state = await getOrCreateProvablyFairState(request.user.sub);
    return reply.send({
      clientSeed: state.clientSeed,
      nonce: state.nonce,
      activeServerSeedHash: state.activeServerSeedHash,
      revealedSeeds: state.revealedSeeds.map((seed) => ({
        id: seed.id,
        serverSeed: seed.serverSeed,
        serverSeedHash: seed.serverSeedHash,
        createdAt: seed.createdAt,
        revealedAt: seed.revealedAt
      }))
    });
  });

  fastify.put("/fairness/client-seed", { preHandler: requireAuth }, async (request, reply) => {
    const body = clientSeedSchema.parse(request.body);
    const updated = await setProvablyFairClientSeed(request.user.sub, body.clientSeed);
    return reply.send(updated);
  });

  fastify.post("/fairness/rotate", { preHandler: requireAuth }, async (request, reply) => {
    const rotated = await rotateProvablyFairServerSeed(request.user.sub);
    return reply.send(rotated);
  });
};
