import { Currency, LedgerReason } from "@prisma/client";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireRoles } from "../../core/auth";
import { requireIdempotencyKey } from "../../core/idempotency";
import { adjustWalletBalance } from "./service";

const COIN_FACTOR = 100_000_000n;

const parseAtomicInput = (value: unknown): bigint | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "bigint") {
    return value;
  }
  const asString = String(value).trim();
  if (!/^-?\d+$/.test(asString)) {
    return null;
  }
  return BigInt(asString);
};

const parseCoinsToAtomic = (value: unknown): bigint | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const asString = String(value).trim();
  if (!/^-?\d+(\.\d{1,8})?$/.test(asString)) {
    return null;
  }

  const sign = asString.startsWith("-") ? -1n : 1n;
  const unsigned = asString.replace(/^[+-]/, "");
  const [wholePart, fractionPartRaw = ""] = unsigned.split(".");
  const fractionPart = (fractionPartRaw + "00000000").slice(0, 8);

  return sign * (BigInt(wholePart) * COIN_FACTOR + BigInt(fractionPart));
};

const resolveCurrency = (value?: string): Currency => {
  if (!value) {
    return Currency.USDT;
  }
  const normalized = value.toUpperCase();
  if (normalized === "COINS") {
    return Currency.USDT;
  }
  if (normalized in Currency) {
    return Currency[normalized as keyof typeof Currency];
  }
  throw new Error("currency must be one of BTC, ETH, USDT, USDC or COINS");
};

const adjustSchema = z.object({
  // Keep flexible to support older/newer admin panels.
  userId: z.string().min(1),
  currency: z.string().optional(),
  amountAtomic: z.union([z.string(), z.number(), z.bigint()]).optional(),
  amountCoins: z.union([z.string(), z.number()]).optional(),
  amount: z.union([z.string(), z.number()]).optional(),
  direction: z.enum(["CREDIT", "DEBIT", "credit", "debit", "+", "-"]).optional(),
  reason: z
    .nativeEnum(LedgerReason)
    .default(LedgerReason.ADMIN_ADJUSTMENT)
    .refine(
      (value) =>
        value !== LedgerReason.BET_HOLD &&
        value !== LedgerReason.BET_RELEASE &&
        value !== LedgerReason.BET_CAPTURE &&
        value !== LedgerReason.BET_PAYOUT,
      {
      message: "Reason is not allowed in this administrative endpoint"
      }
    ),
  referenceId: z.string().max(64).optional(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable()
}).superRefine((value, ctx) => {
  const atomicAmount =
    parseAtomicInput(value.amountAtomic) ??
    parseCoinsToAtomic(value.amountCoins) ??
    parseCoinsToAtomic(value.amount);

  if (atomicAmount === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amountAtomic"],
      message: "Provide amountAtomic (integer) or amountCoins/amount (human)"
    });
    return;
  }

  if (atomicAmount === 0n) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amountAtomic"],
      message: "Amount cannot be 0"
    });
  }
}).transform((value) => {
  const baseAmount =
    parseAtomicInput(value.amountAtomic) ??
    parseCoinsToAtomic(value.amountCoins) ??
    parseCoinsToAtomic(value.amount);

  if (baseAmount === null) {
    // Should be unreachable due to superRefine.
    throw new Error("Invalid amount");
  }

  let amountAtomic = baseAmount;
  const direction = value.direction?.toUpperCase();
  if (direction === "CREDIT" || direction === "+") {
    amountAtomic = amountAtomic < 0n ? -amountAtomic : amountAtomic;
  } else if (direction === "DEBIT" || direction === "-") {
    amountAtomic = amountAtomic > 0n ? -amountAtomic : amountAtomic;
  }

  return {
    userId: value.userId,
    currency: resolveCurrency(value.currency),
    amountAtomic,
    reason: value.reason,
    referenceId: value.referenceId,
    metadata: value.metadata ?? undefined
  };
});

export const ledgerRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/admin/adjust",
    {
      preHandler: [requireRoles(["ADMIN"]), requireIdempotencyKey]
    },
    async (request, reply) => {
      const body = adjustSchema.parse(request.body);

      const result = await adjustWalletBalance({
        actorUserId: request.user.sub,
        userId: body.userId,
        currency: body.currency,
        amountAtomic: body.amountAtomic,
        reason: body.reason,
        idempotencyKey: request.idempotencyKey,
        metadata: body.metadata,
        referenceId: body.referenceId
      });

      return reply.send({
        entry: {
          id: result.entry.id,
          walletId: result.entry.walletId,
          direction: result.entry.direction,
          reason: result.entry.reason,
          amountAtomic: result.entry.amountAtomic.toString(),
          balanceBeforeAtomic: result.entry.balanceBeforeAtomic.toString(),
          balanceAfterAtomic: result.entry.balanceAfterAtomic.toString(),
          referenceId: result.entry.referenceId,
          idempotencyKey: result.entry.idempotencyKey,
          createdAt: result.entry.createdAt
        },
        balanceAtomic: result.balanceAtomic.toString()
      });
    }
  );
};
