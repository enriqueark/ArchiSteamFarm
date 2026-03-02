import { Currency } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

type WalletState = {
  id: string;
  userId: string;
  currency: Currency;
  balanceAtomic: bigint;
  lockedAtomic: bigint;
};

type TxMock = {
  $queryRaw: (...args: unknown[]) => Promise<Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>>;
  wallet: {
    update: (args: {
      where: { id: string };
      data: { balanceAtomic: bigint; lockedAtomic: bigint };
    }) => Promise<void>;
  };
  __releaseLock?: () => void;
};

class AsyncMutex {
  private queue = Promise.resolve();

  public async acquire(): Promise<() => void> {
    let release!: () => void;
    const ticket = new Promise<void>((resolve) => {
      release = resolve;
    });

    const previous = this.queue;
    this.queue = previous.then(() => ticket);
    await previous;

    return release;
  }
}

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

let walletState: WalletState;
let forUpdateCount = 0;
const walletLock = new AsyncMutex();

const prismaMock = {
  $transaction: vi.fn(async <T>(callback: (tx: TxMock) => Promise<T>): Promise<T> => {
    const tx: TxMock = {
      $queryRaw: vi.fn(async (query: unknown, ...values: unknown[]) => {
        const sql = Array.isArray(query) ? query.join(" ") : String(query);
        if (!sql.toUpperCase().includes("FOR UPDATE")) {
          throw new Error("Expected SELECT FOR UPDATE in debitBalance");
        }

        forUpdateCount += 1;
        tx.__releaseLock = await walletLock.acquire();

        const [userId, currency] = values as [string, Currency];
        if (walletState.userId !== userId || walletState.currency !== currency) {
          return [];
        }

        return [
          {
            id: walletState.id,
            balanceAtomic: walletState.balanceAtomic,
            lockedAtomic: walletState.lockedAtomic
          }
        ];
      }),
      wallet: {
        update: vi.fn(async (args) => {
          if (args.where.id !== walletState.id) {
            throw new Error("Wallet id mismatch in test mock");
          }

          await sleep(Math.floor(Math.random() * 3));
          walletState.balanceAtomic = args.data.balanceAtomic;
          walletState.lockedAtomic = args.data.lockedAtomic;

          tx.__releaseLock?.();
          tx.__releaseLock = undefined;
        })
      }
    };

    try {
      return await callback(tx);
    } finally {
      tx.__releaseLock?.();
      tx.__releaseLock = undefined;
    }
  })
};

let debitBalance: (input: {
  userId: string;
  currency: Currency;
  amountAtomic: bigint;
  lockAmountAtomic?: bigint;
}) => Promise<{
  walletId: string;
  balanceBeforeAtomic: bigint;
  balanceAtomic: bigint;
  lockedAtomic: bigint;
}>;

describe("wallet debitBalance concurrency", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("../../infrastructure/db/prisma", () => ({
      prisma: prismaMock
    }));

    ({ debitBalance } = await import("./service"));

    walletState = {
      id: "wallet_test_usdt",
      userId: "user_test_concurrency",
      currency: Currency.USDT,
      balanceAtomic: 100n,
      lockedAtomic: 0n
    };
    forUpdateCount = 0;
    prismaMock.$transaction.mockClear();
  });

  it("handles 100 simultaneous bets without overspending", async () => {
    const concurrentRequests = 100;
    const stakePerBet = 2n;

    const attempts = Array.from({ length: concurrentRequests }, () =>
      debitBalance({
        userId: walletState.userId,
        currency: walletState.currency,
        amountAtomic: stakePerBet,
        lockAmountAtomic: stakePerBet
      })
    );

    const results = await Promise.allSettled(attempts);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    // With 100 initial units and stake 2, at most 50 bets can be accepted.
    expect(fulfilled).toHaveLength(50);
    expect(rejected).toHaveLength(50);

    rejected.forEach((result) => {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(Error);
        expect((result.reason as { code?: string }).code).toBe("INSUFFICIENT_FUNDS");
      }
    });

    expect(forUpdateCount).toBe(100);
    expect(walletState.balanceAtomic).toBe(0n);
    expect(walletState.lockedAtomic).toBe(100n);
    expect(walletState.balanceAtomic).toBeGreaterThanOrEqual(0n);
  });
});
