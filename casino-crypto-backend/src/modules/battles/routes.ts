import { Currency } from "@prisma/client";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import { AppError } from "../../core/errors";
import { requireIdempotencyKey } from "../../core/idempotency";
import { PLATFORM_INTERNAL_CURRENCY } from "../wallets/service";
import {
  callBotForSeat,
  createBattle,
  fillBots,
  getBattleById,
  joinBattle,
  listBattles,
  type BattleDetails,
  type BattleCreateInput
} from "./service";

const battleIdParamsSchema = z.object({
  battleId: z.string().trim().min(1)
});

const listBattlesQuerySchema = z.object({
  includePrivate: z.coerce.boolean().default(false),
  status: z.enum(["OPEN", "RUNNING", "SETTLED", "CANCELLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(120).default(40)
});

const createBattleSchema = z.object({
  template: z.enum([
    "ONE_VS_ONE",
    "TWO_VS_TWO",
    "ONE_VS_ONE_VS_ONE",
    "ONE_VS_ONE_VS_ONE_VS_ONE",
    "ONE_VS_ONE_VS_ONE_VS_ONE_VS_ONE_VS_ONE",
    "TWO_VS_TWO_VS_TWO",
    "THREE_VS_THREE"
  ]),
  modeCrazy: z.boolean().default(false),
  modeGroup: z.boolean().default(false),
  modeJackpot: z.boolean().default(false),
  modeTerminal: z.boolean().default(false),
  modePrivate: z.boolean().default(false),
  modeBorrow: z.boolean().default(false),
  borrowPercent: z.coerce.number().int().min(20).max(100).default(100),
  caseIds: z.array(z.string().cuid()).min(1).max(50),
  currency: z.literal(PLATFORM_INTERNAL_CURRENCY).default(PLATFORM_INTERNAL_CURRENCY)
});

const joinBattleSchema = z.object({
  borrowPercent: z.coerce.number().int().min(20).max(100).default(100),
  currency: z.literal(PLATFORM_INTERNAL_CURRENCY).default(PLATFORM_INTERNAL_CURRENCY)
});

const callBotSchema = z.object({
  seatIndex: z.coerce.number().int().min(0),
  currency: z.literal(PLATFORM_INTERNAL_CURRENCY).default(PLATFORM_INTERNAL_CURRENCY)
});

const fillBotsSchema = z.object({
  currency: z.literal(PLATFORM_INTERNAL_CURRENCY).default(PLATFORM_INTERNAL_CURRENCY)
});

const toBattleResponse = (battle: BattleDetails) => ({
  id: battle.id,
  status: battle.status,
  template: battle.template,
  modeCrazy: battle.modeCrazy,
  modeGroup: battle.modeGroup,
  modeJackpot: battle.modeJackpot,
  modeTerminal: battle.modeTerminal,
  modePrivate: battle.modePrivate,
  modeBorrow: battle.modeBorrow,
  totalCostAtomic: battle.totalCostAtomic.toString(),
  totalPayoutAtomic: battle.totalPayoutAtomic.toString(),
  winnerTeam: battle.winnerTeam,
  winnerUserId: battle.winnerUserId,
  jackpotRoll: battle.jackpotRoll,
  jackpotWinnerSlotId: battle.jackpotWinnerSlotId,
  createdByUserId: battle.createdByUserId,
  createdAt: battle.createdAt,
  startedAt: battle.startedAt,
  settledAt: battle.settledAt,
  cases: battle.cases.map((item: BattleDetails["cases"][number]) => ({
    id: item.id,
    orderIndex: item.orderIndex,
    caseId: item.caseId,
    caseTitle: item.case.title,
    caseSlug: item.case.slug,
    casePriceAtomic: item.priceAtomic.toString()
  })),
  slots: battle.slots.map((slot: BattleDetails["slots"][number]) => ({
    id: slot.id,
    seatIndex: slot.seatIndex,
    teamIndex: slot.teamIndex,
    state: slot.state,
    userId: slot.userId,
    displayName: slot.displayName,
    isBot: slot.isBot,
    borrowPercent: slot.borrowPercent,
    paidAmountAtomic: slot.paidAmountAtomic.toString(),
    payoutAtomic: slot.payoutAtomic.toString(),
    winWeightAtomic: slot.winWeightAtomic.toString(),
    profitAtomic: slot.profitAtomic.toString()
  })),
  drops: battle.drops.map((drop: BattleDetails["drops"][number]) => ({
    id: drop.id,
    roundIndex: drop.roundIndex,
    orderIndex: drop.orderIndex,
    battleCaseId: drop.battleCaseId,
    battleSlotId: drop.battleSlotId,
    caseItemId: drop.caseItem.id,
    caseItemName: drop.caseItem.name,
    valueAtomic: drop.valueAtomic.toString()
  }))
});

export const battlesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", { preHandler: [requireAuth] }, async (request, reply) => {
    const query = listBattlesQuerySchema.parse(request.query);
    const rows = await listBattles({
      userId: request.user.sub,
      includePrivate: query.includePrivate || request.user.role === "ADMIN",
      status: query.status,
      limit: query.limit
    });
    return reply.send(rows.map(toBattleResponse));
  });

  fastify.get("/:battleId", { preHandler: [requireAuth] }, async (request, reply) => {
    const params = battleIdParamsSchema.parse(request.params);
    const row = await getBattleById(params.battleId, request.user.sub);
    return reply.send(toBattleResponse(row));
  });

  fastify.post(
    "/",
    { preHandler: [requireAuth, requireIdempotencyKey] },
    async (request, reply) => {
      const body = createBattleSchema.parse(request.body);
      if ((body.currency as Currency) !== PLATFORM_INTERNAL_CURRENCY) {
        throw new AppError(`Only ${PLATFORM_INTERNAL_CURRENCY} is supported`, 400, "UNSUPPORTED_CURRENCY");
      }
      const caseIds = body.caseIds.filter((value) => value && value.trim().length > 0);
      if (!caseIds.length) {
        throw new AppError("Select at least one case", 400, "BATTLE_CASES_REQUIRED");
      }
      const createInput: BattleCreateInput = {
        userId: request.user.sub,
        template: body.template,
        modeCrazy: body.modeCrazy,
        modeGroup: body.modeGroup,
        modeJackpot: body.modeJackpot,
        modeTerminal: body.modeTerminal,
        modePrivate: body.modePrivate,
        modeBorrow: body.modeBorrow,
        cases: caseIds,
        creatorBorrowPercent: body.borrowPercent
      };
      const row = await createBattle(createInput);
      return reply.send(toBattleResponse(row));
    }
  );

  fastify.post(
    "/:battleId/join",
    { preHandler: [requireAuth, requireIdempotencyKey] },
    async (request, reply) => {
      const params = battleIdParamsSchema.parse(request.params);
      const body = joinBattleSchema.parse(request.body);
      const row = await joinBattle({
        userId: request.user.sub,
        battleId: params.battleId,
        borrowPercent: body.borrowPercent
      });
      return reply.send(toBattleResponse(row));
    }
  );

  fastify.post(
    "/:battleId/call-bot",
    { preHandler: [requireAuth, requireIdempotencyKey] },
    async (request, reply) => {
      const params = battleIdParamsSchema.parse(request.params);
      const body = callBotSchema.parse(request.body);
      const row = await callBotForSeat({
        userId: request.user.sub,
        battleId: params.battleId,
        seatIndex: body.seatIndex
      });
      return reply.send(toBattleResponse(row));
    }
  );

  fastify.post(
    "/:battleId/fill-bots",
    { preHandler: [requireAuth, requireIdempotencyKey] },
    async (request, reply) => {
      const params = battleIdParamsSchema.parse(request.params);
      fillBotsSchema.parse(request.body);
      const row = await fillBots({
        userId: request.user.sub,
        battleId: params.battleId
      });
      return reply.send(toBattleResponse(row));
    }
  );
};

