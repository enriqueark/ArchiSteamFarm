import { Currency, Prisma } from "@prisma/client";

import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";
import { ensureUserAllowedFor } from "../users/access-guard";

export const PLATFORM_INTERNAL_CURRENCY: Currency = Currency.USDT;
export const PLATFORM_VIRTUAL_COIN_SYMBOL = "COINS";
export const PLATFORM_VIRTUAL_COIN_DECIMALS = 8;
export const MAX_GAME_BET_COINS = 5_000n;
export const MAX_GAME_BET_ATOMIC = MAX_GAME_BET_COINS * 10n ** BigInt(PLATFORM_VIRTUAL_COIN_DECIMALS);
export const SUPPORTED_CURRENCIES: Currency[] = [PLATFORM_INTERNAL_CURRENCY];

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
      userId,
      currency: PLATFORM_INTERNAL_CURRENCY
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

const debitBalanceWithRowLock = async (
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

export const debitBalanceInTx = async (
  tx: Prisma.TransactionClient,
  input: DebitBalanceInput
): Promise<DebitBalanceResult> => debitBalanceWithRowLock(tx, input);

export const ensureUserCanBet = async (userId: string): Promise<void> => {
  await ensureUserAllowedFor(userId, "WAGER");
};

export const ensureUserCanWithdraw = async (userId: string): Promise<void> => {
  await ensureUserAllowedFor(userId, "WITHDRAW");
};

export const ensureUserCanTip = async (userId: string): Promise<void> => {
  await ensureUserAllowedFor(userId, "TIP");
};

export const debitBalance = async (input: DebitBalanceInput): Promise<DebitBalanceResult> =>
  prisma.$transaction(async (tx) => debitBalanceWithRowLock(tx, input));
