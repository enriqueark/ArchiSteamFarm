import { Currency } from "@prisma/client";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth, requireRoles } from "../../core/auth";
import { AppError } from "../../core/errors";
import { requireIdempotencyKey } from "../../core/idempotency";
import { PLATFORM_INTERNAL_CURRENCY } from "../wallets/service";
import {
  getCaseById,
  listCases,
  listCasesByAdmin,
  listMyCaseOpenings,
  openCase,
  simulateCasesRtpByAdmin,
  upsertCaseByAdmin,
  setCaseActiveStatusByAdmin,
  type CaseDetails,
  type CaseOpenResult
} from "./service";

const caseIdParamsSchema = z.object({
  caseId: z.string().cuid()
});

const listOpeningsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(30)
});

const openCaseBodySchema = z.object({});

const adminCaseItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  valueAtomic: z
    .string()
    .regex(/^\d+$/, "valueAtomic must be an integer string")
    .transform((value) => BigInt(value)),
  dropRate: z.string().trim().regex(/^\d+(\.\d+)?$/, "dropRate must be a decimal string"),
  imageUrl: z.string().trim().url().optional(),
  sortOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional()
});

const adminUpsertCaseSchema = z.object({
  caseId: z.string().cuid().optional(),
  slug: z.string().trim().min(3).max(64),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  priceAtomic: z
    .string()
    .regex(/^\d+$/, "priceAtomic must be an integer string")
    .transform((value) => BigInt(value))
    .refine((value) => value > 0n, "priceAtomic must be greater than 0"),
  currency: z.literal(PLATFORM_INTERNAL_CURRENCY).default(PLATFORM_INTERNAL_CURRENCY),
  isActive: z.boolean().default(true),
  items: z.array(adminCaseItemSchema).min(1)
});

const adminSetStatusSchema = z.object({
  isActive: z.boolean()
});

const adminRtpSimulationSchema = z.object({
  rounds: z.coerce.number().int().min(1).max(1_000_000).default(100_000)
});

const ensureIdempotencyKey = (request: { idempotencyKey?: string }): string => {
  if (!request.idempotencyKey) {
    throw new AppError("Idempotency-Key header is required", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }
  return request.idempotencyKey;
};

const toCaseResponse = (value: CaseDetails) => ({
  id: value.id,
  slug: value.slug,
  title: value.title,
  description: value.description,
  priceAtomic: value.priceAtomic.toString(),
  currency: value.currency,
  isActive: value.isActive,
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
  items: value.items.map((item) => ({
    id: item.id,
    name: item.name,
    valueAtomic: item.valueAtomic.toString(),
    dropRate: item.dropRate,
    imageUrl: item.imageUrl,
    sortOrder: item.sortOrder,
    isActive: item.isActive
  }))
});

const toOpeningResponse = (value: CaseOpenResult) => ({
  openingId: value.openingId,
  caseId: value.caseId,
  caseSlug: value.caseSlug,
  caseTitle: value.caseTitle,
  item: {
    id: value.item.id,
    name: value.item.name,
    valueAtomic: value.item.valueAtomic.toString(),
    dropRate: value.item.dropRate,
    imageUrl: value.item.imageUrl,
    sortOrder: value.item.sortOrder,
    isActive: value.item.isActive
  },
  topTierEligible: value.topTierEligible,
  topTierItems: value.topTierItems.map((item) => ({
    id: item.id,
    name: item.name,
    valueAtomic: item.valueAtomic.toString(),
    dropRate: item.dropRate,
    imageUrl: item.imageUrl,
    sortOrder: item.sortOrder,
    isActive: item.isActive
  })),
  roll: value.roll,
  payoutAtomic: value.payoutAtomic.toString(),
  profitAtomic: value.profitAtomic.toString(),
  priceAtomic: value.priceAtomic.toString(),
  currency: value.currency,
  provablyFair: value.provablyFair,
  wallet: {
    walletId: value.wallet.walletId,
    balanceAtomic: value.wallet.balanceAtomic.toString(),
    lockedAtomic: value.wallet.lockedAtomic.toString(),
    availableAtomic: value.wallet.balanceAtomic.toString()
  },
  createdAt: value.createdAt
});

export const casesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/openings/me", { preHandler: requireAuth }, async (request, reply) => {
    const query = listOpeningsQuerySchema.parse(request.query);
    const rows = await listMyCaseOpenings(request.user.sub, query.limit);
    return reply.send(rows.map(toOpeningResponse));
  });

  fastify.get("/admin/cases", { preHandler: [requireRoles(["ADMIN"])] }, async (_request, reply) => {
    const rows = await listCasesByAdmin();
    return reply.send(rows.map(toCaseResponse));
  });

  fastify.post(
    "/admin/cases",
    { preHandler: [requireRoles(["ADMIN"]), requireIdempotencyKey] },
    async (request, reply) => {
      const body = adminUpsertCaseSchema.parse(request.body);
      if (body.currency !== PLATFORM_INTERNAL_CURRENCY) {
        throw new AppError(`Only ${PLATFORM_INTERNAL_CURRENCY} is supported`, 400, "UNSUPPORTED_CURRENCY");
      }
      const saved = await upsertCaseByAdmin({
        actorUserId: request.user.sub,
        caseId: body.caseId,
        slug: body.slug,
        title: body.title,
        description: body.description ?? null,
        priceAtomic: body.priceAtomic,
        currency: body.currency as Currency,
        isActive: body.isActive,
        items: body.items
      });
      return reply.send(toCaseResponse(saved));
    }
  );

  fastify.patch(
    "/admin/cases/:caseId/status",
    { preHandler: [requireRoles(["ADMIN"])] },
    async (request, reply) => {
      const params = caseIdParamsSchema.parse(request.params);
      const body = adminSetStatusSchema.parse(request.body);
      const updated = await setCaseActiveStatusByAdmin(params.caseId, body.isActive);
      return reply.send(toCaseResponse(updated));
    }
  );

  fastify.post(
    "/admin/simulate-rtp",
    { preHandler: [requireRoles(["ADMIN"])] },
    async (request, reply) => {
      const body = adminRtpSimulationSchema.parse(request.body);
      const rows = await simulateCasesRtpByAdmin(body.rounds);
      return reply.send(
        rows.map((row) => ({
          caseId: row.caseId,
          rounds: row.rounds,
          spentAtomic: row.spentAtomic.toString(),
          payoutAtomic: row.payoutAtomic.toString(),
          profitAtomic: row.profitAtomic.toString(),
          rtpPercent: row.rtpPercent,
          hitTopTierCount: row.hitTopTierCount
        }))
      );
    }
  );

  fastify.get("/", async (_request, reply) => {
    const rows = await listCases();
    return reply.send(
      rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        priceAtomic: row.priceAtomic.toString(),
        currency: row.currency,
        isActive: row.isActive,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        itemCount: row.itemCount
      }))
    );
  });

  fastify.get("/:caseId", async (request, reply) => {
    const params = caseIdParamsSchema.parse(request.params);
    const row = await getCaseById(params.caseId);
    return reply.send(toCaseResponse(row));
  });

  fastify.post(
    "/:caseId/open",
    {
      preHandler: [requireAuth, requireIdempotencyKey]
    },
    async (request, reply) => {
      const params = caseIdParamsSchema.parse(request.params);
      openCaseBodySchema.parse(request.body);
      const opening = await openCase({
        userId: request.user.sub,
        caseId: params.caseId,
        idempotencyKey: ensureIdempotencyKey(request)
      });
      return reply.code(201).send(toOpeningResponse(opening));
    }
  );

};
