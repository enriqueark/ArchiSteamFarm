const TEST_GAME_ENGINE_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEICT69Ubou04ZJSo+s1a9BZBUmLgHzNlRng2F5MbdvmvX
-----END PRIVATE KEY-----`;

const TEST_GAME_ENGINE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEALHUqaQ1GH14Ty+7bT46fcWPnVcNA65/fVrFP5luTliY=
-----END PUBLIC KEY-----`;

process.env["GAME_ENGINE_SERVICE_TOKEN"] ??= "test_game_engine_token_abcdefghijklmnopqrstuvwxyz";
process.env["GAME_ENGINE_PUBLIC_KEY"] ??= TEST_GAME_ENGINE_PUBLIC_KEY_PEM;
process.env["GAME_RESULT_SIGNATURE_MAX_AGE_SECONDS"] ??= "120";

import { Currency, LedgerReason } from "@prisma/client";
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/db/prisma";
import { GAME_ENGINE_SERVICE_ROLE } from "../../core/service-auth";
import { settleBet, placeBet } from "./service";

const runDbTests = process.env["RUN_DB_TESTS"] === "true";
const betsDescribe = runDbTests ? describe.sequential : describe.skip;

type CreatedUser = {
  userId: string;
  walletId: string;
};

const createdUsers: string[] = [];
const gameEnginePrivateKey = createPrivateKey(TEST_GAME_ENGINE_PRIVATE_KEY_PEM);

const signResultPayload = (input: {
  betId: string;
  gameType: string;
  roundReference: string;
  gameResult: "WON" | "LOST";
  issuedAt: string;
  nonce: string;
}): string => {
  const payload = [
    input.betId,
    input.gameType,
    input.roundReference,
    input.gameResult,
    input.issuedAt,
    input.nonce
  ].join("|");

  return sign(null, Buffer.from(payload), gameEnginePrivateKey).toString("base64");
};

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
      await cleanupUser(userId).catch(() => undefined);
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

    const betRecord = await prisma.casinoBet.findUnique({
      where: { id: placed.betId },
      select: {
        id: true,
        gameType: true,
        roundReference: true
      }
    });
    expect(betRecord).not.toBeNull();

    const issuedAt = new Date().toISOString();
    const nonce = `nonce-${randomUUID()}`;
    const signature = signResultPayload({
      betId: betRecord!.id,
      gameType: betRecord!.gameType,
      roundReference: betRecord!.roundReference,
      gameResult: "WON",
      issuedAt,
      nonce
    });

    const settles = Array.from({ length: 100 }, () =>
      settleBet({
        betId: placed.betId,
        actor: {
          serviceRole: GAME_ENGINE_SERVICE_ROLE
        },
        signedGameResult: {
          gameResult: "WON",
          issuedAt,
          nonce,
          signature
        }
      })
    );

    const settledResults = await Promise.allSettled(settles);
    const success = settledResults.filter((result) => result.status === "fulfilled");
    const failed = settledResults.filter((result) => result.status === "rejected");

    // Replays of the same signed payload are idempotent; all calls may return the same settled outcome.
    expect(success.length).toBeGreaterThanOrEqual(1);
    expect(failed).toHaveLength(0);

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

    const betRecord = await prisma.casinoBet.findUnique({
      where: { id: placed.betId },
      select: {
        id: true,
        gameType: true,
        roundReference: true
      }
    });
    expect(betRecord).not.toBeNull();

    const firstNonce = `nonce-${randomUUID()}`;
    const firstIssuedAt = new Date().toISOString();
    const firstSignature = signResultPayload({
      betId: betRecord!.id,
      gameType: betRecord!.gameType,
      roundReference: betRecord!.roundReference,
      gameResult: "LOST",
      issuedAt: firstIssuedAt,
      nonce: firstNonce
    });

    const firstSettle = await settleBet({
      betId: placed.betId,
      actor: {
        serviceRole: GAME_ENGINE_SERVICE_ROLE
      },
      signedGameResult: {
        gameResult: "LOST",
        issuedAt: firstIssuedAt,
        nonce: firstNonce,
        signature: firstSignature
      }
    });

    expect(firstSettle.status).toBe("LOST");
    expect(firstSettle.balanceAfter).toBe(950n);
    expect(firstSettle.lockedAfter).toBe(0n);

    const secondNonce = `nonce-${randomUUID()}`;
    const secondIssuedAt = new Date().toISOString();
    const secondSignature = signResultPayload({
      betId: betRecord!.id,
      gameType: betRecord!.gameType,
      roundReference: betRecord!.roundReference,
      gameResult: "LOST",
      issuedAt: secondIssuedAt,
      nonce: secondNonce
    });

    await expect(
      settleBet({
        betId: placed.betId,
        actor: {
          serviceRole: GAME_ENGINE_SERVICE_ROLE
        },
        signedGameResult: {
          gameResult: "LOST",
          issuedAt: secondIssuedAt,
          nonce: secondNonce,
          signature: secondSignature
        }
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
