import { Currency } from "@prisma/client";

import { prisma } from "../../infrastructure/db/prisma";

export const SUPPORTED_CURRENCIES: Currency[] = [Currency.BTC, Currency.ETH, Currency.USDT, Currency.USDC];

export const createDefaultWallets = async (userId: string): Promise<void> => {
  await prisma.wallet.createMany({
    data: SUPPORTED_CURRENCIES.map((currency) => ({
      userId,
      currency
    })),
    skipDuplicates: true
  });
};

export const getWalletsByUser = async (userId: string) =>
  prisma.wallet.findMany({
    where: {
      userId
    },
    orderBy: {
      createdAt: "asc"
    }
  });
