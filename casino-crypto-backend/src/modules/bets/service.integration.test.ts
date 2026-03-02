import { Currency, LedgerReason } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/db/prisma";
import { settleBet, placeBet } from "./service";

const runDbTests = process.env["RUN_DB_TESTS"] === "true";
const betsDescribe = runDbTests ? describe.sequential : describe.skip;

type CreatedUser = {
  userId: string;
  walletId: string;
};

const createdUsers: string[] = [];

const createUserWithWallet = async (balanceAtomic: bigint, currency: Currency): Promise<CreatedUser> => {
  const user = await prisma.user.create({
    data: {
      email: `bets-it-${randomUUID()}@example.com`,
      passwordHash: "integration-test-password-hash"
    },
    select: {
      id: true
    }
  });

  const wallet = await prisma.wallet.create({
    data: {
      userId: user.id,
      currency,
      balanceAtomic,
      lockedAtomic: 0n
    },
    select: {
      id: true
    }
  });

  createdUsers.push(user.id);

  return {
    userId: user.id,
    walletId: wallet.id
  };
};

const cleanupUser = async (userId: string): Promise<void> => {
  const wallets = await prisma.wallet.findMany({
    where: { userId },
    select: { id: true }
  });
  const walletIds = wallets.map((wallet) => wallet.id);

  await prisma.casinoBet.deleteMany({
    where: { userId }
  });

  if (walletIds.length > 0) {
    await prisma.ledgerEntry.deleteMany({
      where: {
        walletId: {
          in: walletIds
        }
      }
    });
  }

  await prisma.wallet.deleteMany({
    where: {
      userId
    }
  });

  await prisma.user.deleteMany({
    where: {
      id: userId
    }
  });
};

betsDescribe("casino bet transactional flow (no mocks)", () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    for (const userId of createdUsers) {
      await cleanupUser(userId);
    }

    await prisma.$disconnect();
  });

  it("prevents double settlement under 100 concurrent settle attempts", async () => {
    const { userId, walletId } = await createUserWithWallet(1000n, Currency.USDT);
    const placed = await placeBet({
      userId,
      currency: Currency.USDT,
      gameType: "ROULETTE",
      roundReference: `round-${randomUUID()}`,
      multiplier: "1.80000000",
      amountAtomic: 100n,
      placeIdempotencyKey: `place-${randomUUID()}`
    });

    expect(placed.balanceBefore).toBe(1000n);
    expect(placed.balanceAfter).toBe(900n);
    expect(placed.lockedAfter).toBe(100n);

    const settles = Array.from({ length: 100 }, () =>
      settleBet({
        betId: placed.betId,
        gameResult: "WON"
      })
    );

    const settledResults = await Promise.allSettled(settles);
    const success = settledResults.filter((result) => result.status === "fulfilled");
    const failed = settledResults.filter((result) => result.status === "rejected");

    expect(success).toHaveLength(1);
    expect(failed).toHaveLength(99);

    failed.forEach((entry) => {
      if (entry.status === "rejected") {
        expect((entry.reason as { code?: string }).code).toBe("BET_ALREADY_SETTLED");
      }
    });

    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: {
        balanceAtomic: true,
        lockedAtomic: true
      }
    });

    expect(wallet?.balanceAtomic).toBe(1080n);
    expect(wallet?.lockedAtomic).toBe(0n);

    const bet = await prisma.casinoBet.findUnique({
      where: { id: placed.betId },
      select: {
        status: true,
        payoutAtomic: true
      }
    });

    expect(bet?.status).toBe("WON");
    expect(bet?.payoutAtomic).toBe(180n);

    const captureEntries = await prisma.ledgerEntry.count({
      where: {
        referenceId: placed.betId,
        reason: LedgerReason.BET_CAPTURE
      }
    });

    const payoutEntries = await prisma.ledgerEntry.count({
      where: {
        referenceId: placed.betId,
        reason: LedgerReason.BET_PAYOUT
      }
    });

    // Exactly one capture + one payout proves "settle once" under high contention.
    expect(captureEntries).toBe(1);
    expect(payoutEntries).toBe(1);
  });

  it("rejects a second settle attempt and keeps wallet consistent", async () => {
    const { userId, walletId } = await createUserWithWallet(1000n, Currency.USDT);
    const placed = await placeBet({
      userId,
      currency: Currency.USDT,
      gameType: "MINES",
      roundReference: `round-${randomUUID()}`,
      multiplier: "2.00000000",
      amountAtomic: 50n,
      placeIdempotencyKey: `place-${randomUUID()}`
    });

    const firstSettle = await settleBet({
      betId: placed.betId,
      gameResult: "LOST"
    });

    expect(firstSettle.status).toBe("LOST");
    expect(firstSettle.balanceAfter).toBe(950n);
    expect(firstSettle.lockedAfter).toBe(0n);

    await expect(
      settleBet({
        betId: placed.betId,
        gameResult: "LOST"
      })
    ).rejects.toMatchObject({
      code: "BET_ALREADY_SETTLED"
    });

    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: {
        balanceAtomic: true,
        lockedAtomic: true
      }
    });

    expect(wallet?.balanceAtomic).toBe(950n);
    expect(wallet?.lockedAtomic).toBe(0n);

    const captureEntries = await prisma.ledgerEntry.count({
      where: {
        referenceId: placed.betId,
        reason: LedgerReason.BET_CAPTURE
      }
    });
    const payoutEntries = await prisma.ledgerEntry.count({
      where: {
        referenceId: placed.betId,
        reason: LedgerReason.BET_PAYOUT
      }
    });

    expect(captureEntries).toBe(1);
    expect(payoutEntries).toBe(0);
  });
});
