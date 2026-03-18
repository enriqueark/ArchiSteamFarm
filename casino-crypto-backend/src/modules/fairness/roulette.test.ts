import { describe, expect, it } from "vitest";

import { hashToRouletteWinningNumber, computeRouletteFairHash } from "./hash";

describe("roulette provably fair primitives", () => {
  it("produces deterministic sha256(serverSeed:clientSeed:nonce) hashes", () => {
    const serverSeed = "server-seed-a";
    const clientSeed = "client-seed-a";
    const nonce = 42;

    const hashA = computeRouletteFairHash(serverSeed, clientSeed, nonce);
    const hashB = computeRouletteFairHash(serverSeed, clientSeed, nonce);
    const hashC = computeRouletteFairHash(serverSeed, clientSeed, nonce + 1);

    expect(hashA).toBe(hashB);
    expect(hashA).not.toBe(hashC);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
  });

  it("maps fairness hash to winning numbers within roulette bounds", () => {
    const min = 1;
    const max = 15;

    for (let nonce = 0; nonce < 10_000; nonce += 1) {
      const hash = computeRouletteFairHash("server-seed", "client-seed", nonce);
      const winningNumber = hashToRouletteWinningNumber(hash, min, max);
      expect(winningNumber).toBeGreaterThanOrEqual(min);
      expect(winningNumber).toBeLessThanOrEqual(max);
    }
  });
});
