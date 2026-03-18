import { describe, expect, it } from "vitest";

import { BOARD_SIZE, HOUSE_EDGE, buildMineIndexes, calculateMultiplier, computeFairHash } from "./provably-fair";

describe("mines multiplier anti-abuse calibration", () => {
  it("keeps 1-mine early cashouts below x1 and reaches x1 at 3 safe reveals", () => {
    const oneSafe = calculateMultiplier(1, 1, BOARD_SIZE, HOUSE_EDGE);
    const twoSafe = calculateMultiplier(1, 2, BOARD_SIZE, HOUSE_EDGE);
    const threeSafe = calculateMultiplier(1, 3, BOARD_SIZE, HOUSE_EDGE);
    const fourSafe = calculateMultiplier(1, 4, BOARD_SIZE, HOUSE_EDGE);

    expect(oneSafe).toBeLessThan(1);
    expect(twoSafe).toBeLessThan(1);
    expect(threeSafe).toBeCloseTo(1, 8);
    expect(fourSafe).toBeGreaterThan(1);
  });

  it("normalizes equivalent risk points across mine counts", () => {
    // Requested baseline equivalence:
    // (1 mine, 3 safe) and (3 mines, 1 safe) should both resolve to x1.
    expect(calculateMultiplier(1, 3, BOARD_SIZE, HOUSE_EDGE)).toBeCloseTo(1, 8);
    expect(calculateMultiplier(3, 1, BOARD_SIZE, HOUSE_EDGE)).toBeCloseTo(1, 8);
  });

  it("still increases payout with higher risk after normalization", () => {
    expect(calculateMultiplier(3, 2, BOARD_SIZE, HOUSE_EDGE)).toBeGreaterThan(1);
    expect(calculateMultiplier(5, 1, BOARD_SIZE, HOUSE_EDGE)).toBeGreaterThan(1);
  });
});

describe("mines provably fair primitives", () => {
  it("computes deterministic sha256(serverSeed:clientSeed:nonce)", () => {
    const hashA = computeFairHash("server-seed", "client-seed", 7);
    const hashB = computeFairHash("server-seed", "client-seed", 7);
    const hashC = computeFairHash("server-seed", "client-seed", 8);

    expect(hashA).toBe(hashB);
    expect(hashA).not.toBe(hashC);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
  });

  it("creates deterministic mine index sets from the same fairness inputs", () => {
    const first = buildMineIndexes("server-seed", "client-seed", 3, 5, 25);
    const second = buildMineIndexes("server-seed", "client-seed", 3, 5, 25);
    const differentNonce = buildMineIndexes("server-seed", "client-seed", 4, 5, 25);

    expect(first).toEqual(second);
    expect(first).not.toEqual(differentNonce);
    expect(first).toHaveLength(5);
  });
});
