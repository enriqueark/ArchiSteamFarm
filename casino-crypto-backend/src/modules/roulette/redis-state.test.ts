import { Currency, RouletteBetType, RouletteRoundStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

const { fakeRedis } = vi.hoisted(() => {
  const stringStore = new Map<string, string>();
  const setStore = new Map<string, Set<string>>();

  const fakeRedis = {
    async set(key: string, value: string): Promise<string> {
      stringStore.set(key, value);
      return "OK";
    },
    async get(key: string): Promise<string | null> {
      return stringStore.get(key) ?? null;
    },
    async sadd(key: string, member: string): Promise<number> {
      const set = setStore.get(key) ?? new Set<string>();
      set.add(member);
      setStore.set(key, set);
      return set.size;
    },
    async srem(key: string, member: string): Promise<number> {
      const set = setStore.get(key);
      if (!set) {
        return 0;
      }
      const existed = set.delete(member);
      return existed ? 1 : 0;
    },
    async scard(key: string): Promise<number> {
      return setStore.get(key)?.size ?? 0;
    },
    async del(key: string): Promise<number> {
      const existed = stringStore.delete(key);
      return existed ? 1 : 0;
    },
    async expire(_key: string, _seconds: number): Promise<number> {
      return 1;
    },
    pipeline() {
      const operations: Array<() => Promise<unknown>> = [];
      return {
        sadd(key: string, member: string) {
          operations.push(() => fakeRedis.sadd(key, member));
          return this;
        },
        expire(key: string, seconds: number) {
          operations.push(() => fakeRedis.expire(key, seconds));
          return this;
        },
        set(key: string, value: string, _ex: string, _ttl: number) {
          operations.push(() => fakeRedis.set(key, value));
          return this;
        },
        srem(key: string, member: string) {
          operations.push(() => fakeRedis.srem(key, member));
          return this;
        },
        del(key: string) {
          operations.push(() => fakeRedis.del(key));
          return this;
        },
        async exec() {
          await Promise.all(operations.map((op) => op()));
          return [];
        }
      };
    }
  };

  return { fakeRedis };
});

vi.mock("../../infrastructure/redis/client", () => ({
  redis: fakeRedis
}));

import {
  getActiveRouletteBetCount,
  getPersistedRouletteRoundState,
  persistRouletteRoundState,
  settleActiveRouletteBet,
  toRoulettePhase,
  trackActiveRouletteBet
} from "./redis-state";

describe("roulette redis state persistence", () => {
  it("persists and retrieves shared round state", async () => {
    await persistRouletteRoundState({
      roundId: "round-1",
      roundNumber: 1,
      currency: Currency.USDT,
      status: RouletteRoundStatus.OPEN,
      phase: "BETTING",
      openAt: new Date().toISOString(),
      betsCloseAt: new Date().toISOString(),
      spinStartsAt: new Date().toISOString(),
      settleAt: new Date().toISOString(),
      winningNumber: null,
      winningColor: null,
      winningIsBait: null,
      totalStakedAtomic: "100",
      totalPayoutAtomic: "0",
      updatedAt: new Date().toISOString()
    });

    const state = await getPersistedRouletteRoundState(Currency.USDT);
    expect(state?.roundId).toBe("round-1");
    expect(state?.currency).toBe(Currency.USDT);
  });

  it("tracks and settles active bets in redis", async () => {
    await trackActiveRouletteBet({
      roundId: "round-2",
      betId: "bet-1",
      userId: "user-1",
      currency: Currency.USDT,
      betType: RouletteBetType.RED,
      stakeAtomic: "100",
      createdAt: new Date().toISOString()
    });

    expect(await getActiveRouletteBetCount("round-2")).toBe(1);
    await settleActiveRouletteBet("round-2", "bet-1");
    expect(await getActiveRouletteBetCount("round-2")).toBe(0);
  });

  it("maps roulette status to broadcast phases", () => {
    expect(toRoulettePhase(RouletteRoundStatus.OPEN)).toBe("BETTING");
    expect(toRoulettePhase(RouletteRoundStatus.SPINNING)).toBe("SPINNING");
    expect(toRoulettePhase(RouletteRoundStatus.SETTLED)).toBe("RESULT");
  });
});
