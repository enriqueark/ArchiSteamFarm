import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "../../infrastructure/db/prisma";

export const DEFAULT_BLACKJACK_SIDEBET_CONFIG = {
  pairsMultiplier: "11.00",
  plus3Multiplier: "9.00"
} as const;

const CONFIG_KEY = "BLACKJACK_SIDEBETS";

export type BlackjackSidebetConfig = {
  pairsMultiplier: Prisma.Decimal;
  plus3Multiplier: Prisma.Decimal;
};

const toDecimal = (value: unknown, fallback: string): Prisma.Decimal => {
  if (typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value)) {
    return new Prisma.Decimal(value);
  }
  return new Prisma.Decimal(fallback);
};

const getPlatformConfigDelegate = (): PrismaClient["platformConfig"] => {
  const delegate = (prisma as PrismaClient).platformConfig;
  if (!delegate) {
    throw new Error("PlatformConfig delegate is not available on Prisma client");
  }
  return delegate;
};

export const getBlackjackPayoutConfig = async (): Promise<BlackjackSidebetConfig> => {
  const row = await getPlatformConfigDelegate().findUnique({
    where: { key: CONFIG_KEY }
  });

  if (!row || !row.value || typeof row.value !== "object" || Array.isArray(row.value)) {
    return {
      pairsMultiplier: new Prisma.Decimal(DEFAULT_BLACKJACK_SIDEBET_CONFIG.pairsMultiplier),
      plus3Multiplier: new Prisma.Decimal(DEFAULT_BLACKJACK_SIDEBET_CONFIG.plus3Multiplier)
    };
  }

  const payload = row.value as Record<string, unknown>;
  return {
    pairsMultiplier: toDecimal(payload.pairsMultiplier, DEFAULT_BLACKJACK_SIDEBET_CONFIG.pairsMultiplier),
    plus3Multiplier: toDecimal(payload.plus3Multiplier, DEFAULT_BLACKJACK_SIDEBET_CONFIG.plus3Multiplier)
  };
};

export const setBlackjackPayoutConfig = async (input: {
  pairsMultiplier: Prisma.Decimal;
  plus3Multiplier: Prisma.Decimal;
}): Promise<BlackjackSidebetConfig> => {
  const value: Prisma.InputJsonValue = {
    pairsMultiplier: input.pairsMultiplier.toFixed(2),
    plus3Multiplier: input.plus3Multiplier.toFixed(2)
  };

  await getPlatformConfigDelegate().upsert({
    where: { key: CONFIG_KEY },
    update: { value },
    create: {
      key: CONFIG_KEY,
      value
    }
  });

  return {
    pairsMultiplier: input.pairsMultiplier,
    plus3Multiplier: input.plus3Multiplier
  };
};
