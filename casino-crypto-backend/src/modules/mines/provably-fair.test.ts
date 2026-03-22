import { describe, expect, it } from "vitest";

import { calculateMultiplier } from "./provably-fair";

describe("mines multiplier normalization", () => {
  it("keeps 1 mine + 3 safe reveals at exactly x1", () => {
    const multiplier = calculateMultiplier(1, 3);
    expect(multiplier).toBe(1);
  });

  it("keeps 3 mines + 1 safe reveal at exactly x1", () => {
    const multiplier = calculateMultiplier(3, 1);
    expect(multiplier).toBe(1);
  });

  it("makes 1 mine + 1 safe reveal below x1", () => {
    const multiplier = calculateMultiplier(1, 1);
    expect(multiplier).toBeLessThan(1);
  });
});
