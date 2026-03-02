import { Currency, Prisma } from "@prisma/client";

import { AppError } from "../../core/errors";
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

type DebitBalanceInput = {
  userId: string;
  currency: Currency;
  amountAtomic: bigint;
  lockAmountAtomic?: bigint;
};

type DebitBalanceResult = {
  walletId: string;
  balanceBeforeAtomic: bigint;
  balanceAtomic: bigint;
  lockedAtomic: bigint;
};

type WalletLockedRow = {
  id: string;
  balanceAtomic: bigint;
  lockedAtomic: bigint;
};

export const debitBalance = async (
  tx: Prisma.TransactionClient,
  input: DebitBalanceInput
): Promise<DebitBalanceResult> => {
  if (input.amountAtomic <= 0n) {
    throw new AppError("amountAtomic must be greater than 0", 400, "INVALID_AMOUNT");
  }

  const lockAmountAtomic = input.lockAmountAtomic ?? 0n;
  if (lockAmountAtomic < 0n) {
    throw new AppError("lockAmountAtomic cannot be negative", 400, "INVALID_LOCK_AMOUNT");
  }

  const lockedRows = await tx.$queryRaw<WalletLockedRow[]>`
    SELECT id, "balanceAtomic", "lockedAtomic"
    FROM "wallets"
    WHERE "userId" = ${input.userId}
      AND "currency" = ${input.currency}
    FOR UPDATE
  `;

  const wallet = lockedRows[0];
  if (!wallet) {
    throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
  }

  if (wallet.balanceAtomic < input.amountAtomic) {
    throw new AppError("Insufficient funds", 422, "INSUFFICIENT_FUNDS");
  }

  const nextBalance = wallet.balanceAtomic - input.amountAtomic;
  const nextLocked = wallet.lockedAtomic + lockAmountAtomic;

  await tx.wallet.update({
    where: {
      id: wallet.id
    },
    data: {
      balanceAtomic: nextBalance,
      lockedAtomic: nextLocked
    }
  });

  return {
    walletId: wallet.id,
    balanceBeforeAtomic: wallet.balanceAtomic,
    balanceAtomic: nextBalance,
    lockedAtomic: nextLocked
  };
};
