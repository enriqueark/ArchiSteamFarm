import { LedgerReason } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";
import { adjustWalletBalance } from "../ledger/service";
import { PLATFORM_INTERNAL_CURRENCY } from "../wallets/service";

const HOUR_MS = 60 * 60 * 1000;
const VALID_LOCK_WINDOWS_HOURS = new Set([1, 24, 72, 168]);

const getOrCreateVault = async (userId: string) => {
  const existing = await prisma.vaultAccount.findUnique({
    where: { userId }
  });
  if (existing) {
    return existing;
  }
  return prisma.vaultAccount.create({
    data: {
      userId
    }
  });
};

export const settleMaturedVaultLocks = async (userId: string): Promise<void> => {
  const vault = await getOrCreateVault(userId);
  const now = new Date();
  const matured = await prisma.vaultLock.findMany({
    where: {
      vaultId: vault.id,
      unlockAt: { lte: now }
    }
  });
  if (!matured.length) {
    return;
  }
  const total = matured.reduce((acc, row) => acc + row.amountAtomic, 0n);
  await prisma.$transaction(async (tx) => {
    await tx.vaultLock.deleteMany({
      where: {
        id: { in: matured.map((row) => row.id) }
      }
    });
    await tx.vaultAccount.update({
      where: { id: vault.id },
      data: {
        balanceAtomic: { decrement: total }
      }
    });
  });
};

export const getVaultState = async (userId: string) => {
  await settleMaturedVaultLocks(userId);
  const vault = await getOrCreateVault(userId);
  const now = new Date();
  const [activeLocks, unlockedCreditAtomic] = await Promise.all([
    prisma.vaultLock.findMany({
      where: {
        vaultId: vault.id,
        unlockAt: { gt: now }
      },
      orderBy: { unlockAt: "asc" }
    }),
    prisma.vaultLock.aggregate({
      where: {
        vaultId: vault.id,
        unlockAt: { lte: now }
      },
      _sum: { amountAtomic: true }
    })
  ]);

  const lockedAtomic = activeLocks.reduce((acc, row) => acc + row.amountAtomic, 0n);
  const availableAtomic = vault.balanceAtomic - lockedAtomic;
  const releasableAtomic = unlockedCreditAtomic._sum.amountAtomic ?? 0n;

  return {
    vaultId: vault.id,
    balanceAtomic: vault.balanceAtomic.toString(),
    availableAtomic: availableAtomic.toString(),
    lockedAtomic: lockedAtomic.toString(),
    releasableAtomic: releasableAtomic.toString(),
    locks: activeLocks.map((row) => ({
      id: row.id,
      amountAtomic: row.amountAtomic.toString(),
      unlockAt: row.unlockAt,
      createdAt: row.createdAt
    }))
  };
};

export const depositToVault = async (input: {
  userId: string;
  amountAtomic: bigint;
  lockDuration?: "1H" | "1D" | "3D" | "7D";
  idempotencyKey?: string;
}) => {
  if (input.amountAtomic <= 0n) {
    throw new AppError("amountAtomic must be greater than 0", 400, "INVALID_AMOUNT");
  }
  const lockHours =
    input.lockDuration === "1H"
      ? 1
      : input.lockDuration === "1D"
        ? 24
        : input.lockDuration === "3D"
          ? 72
          : input.lockDuration === "7D"
            ? 168
            : undefined;
  if (typeof lockHours === "number" && !VALID_LOCK_WINDOWS_HOURS.has(lockHours)) {
    throw new AppError("Invalid lock period. Allowed: 1h, 24h, 72h, 168h", 400, "INVALID_VAULT_LOCK_WINDOW");
  }

  const idempotencyKey = input.idempotencyKey ?? `vault:deposit:${randomUUID()}`;
  const walletIdempotency = `${idempotencyKey}:wallet`;

  const walletEntry = await adjustWalletBalance({
    actorUserId: input.userId,
    userId: input.userId,
    currency: PLATFORM_INTERNAL_CURRENCY,
    amountAtomic: -input.amountAtomic,
    reason: LedgerReason.VAULT_DEPOSIT,
    idempotencyKey: walletIdempotency,
    metadata: {
      source: "VAULT_DEPOSIT"
    }
  });

  const vault = await getOrCreateVault(input.userId);
  await prisma.$transaction(async (tx) => {
    await tx.vaultAccount.update({
      where: { id: vault.id },
      data: {
        balanceAtomic: { increment: input.amountAtomic }
      }
    });

    if (typeof lockHours === "number") {
      await tx.vaultLock.create({
        data: {
          vaultId: vault.id,
          amountAtomic: input.amountAtomic,
          unlockAt: new Date(Date.now() + lockHours * HOUR_MS)
        }
      });
    }
  });

  return {
    ok: true,
    amountAtomic: input.amountAtomic.toString(),
    walletBalanceAtomic: walletEntry.balanceAtomic.toString()
  };
};

export const withdrawFromVault = async (input: {
  userId: string;
  amountAtomic: bigint;
  idempotencyKey?: string;
}) => {
  if (input.amountAtomic <= 0n) {
    throw new AppError("amountAtomic must be greater than 0", 400, "INVALID_AMOUNT");
  }
  await settleMaturedVaultLocks(input.userId);
  const vault = await getOrCreateVault(input.userId);

  const now = new Date();
  const activeLocks = await prisma.vaultLock.findMany({
    where: {
      vaultId: vault.id,
      unlockAt: { gt: now }
    }
  });
  const lockedAtomic = activeLocks.reduce((acc, row) => acc + row.amountAtomic, 0n);
  const availableAtomic = vault.balanceAtomic - lockedAtomic;
  if (availableAtomic < input.amountAtomic) {
    throw new AppError("Insufficient available vault funds", 422, "INSUFFICIENT_VAULT_FUNDS");
  }

  const idempotencyKey = input.idempotencyKey ?? `vault:withdraw:${randomUUID()}`;
  const walletIdempotency = `${idempotencyKey}:wallet`;

  await prisma.vaultAccount.update({
    where: { id: vault.id },
    data: {
      balanceAtomic: { decrement: input.amountAtomic }
    }
  });

  const walletEntry = await adjustWalletBalance({
    actorUserId: input.userId,
    userId: input.userId,
    currency: PLATFORM_INTERNAL_CURRENCY,
    amountAtomic: input.amountAtomic,
    reason: LedgerReason.VAULT_WITHDRAW,
    idempotencyKey: walletIdempotency,
    metadata: {
      source: "VAULT_WITHDRAW"
    }
  });

  return {
    ok: true,
    amountAtomic: input.amountAtomic.toString(),
    walletBalanceAtomic: walletEntry.balanceAtomic.toString()
  };
};
