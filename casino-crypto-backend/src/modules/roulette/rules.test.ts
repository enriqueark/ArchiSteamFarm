import { RouletteBetType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  ROULETTE_BAIT_LEFT_NUMBER,
  ROULETTE_BAIT_RIGHT_NUMBER,
  ROULETTE_GREEN_NUMBER,
  evaluateRouletteBet,
  validateRouletteBetInput
} from "./rules";

describe("roulette 15-slot rules", () => {
  it("pays red and black at x2", () => {
    expect(evaluateRouletteBet(RouletteBetType.RED, 1)).toEqual({ won: true, payoutMultiplier: 2 });
    expect(evaluateRouletteBet(RouletteBetType.RED, 2)).toEqual({ won: false, payoutMultiplier: 2 });

    expect(evaluateRouletteBet(RouletteBetType.BLACK, 2)).toEqual({ won: true, payoutMultiplier: 2 });
    expect(evaluateRouletteBet(RouletteBetType.BLACK, 1)).toEqual({ won: false, payoutMultiplier: 2 });
  });

  it("pays green at x14", () => {
    expect(evaluateRouletteBet(RouletteBetType.GREEN, ROULETTE_GREEN_NUMBER)).toEqual({
      won: true,
      payoutMultiplier: 14
    });
    expect(evaluateRouletteBet(RouletteBetType.GREEN, 1)).toEqual({ won: false, payoutMultiplier: 14 });
  });

  it("pays bait at x7 for both neighbors of green", () => {
    expect(evaluateRouletteBet(RouletteBetType.BAIT, ROULETTE_BAIT_LEFT_NUMBER)).toEqual({
      won: true,
      payoutMultiplier: 7
    });
    expect(evaluateRouletteBet(RouletteBetType.BAIT, ROULETTE_BAIT_RIGHT_NUMBER)).toEqual({
      won: true,
      payoutMultiplier: 7
    });
    expect(evaluateRouletteBet(RouletteBetType.BAIT, ROULETTE_GREEN_NUMBER)).toEqual({
      won: false,
      payoutMultiplier: 7
    });
  });

  it("rejects non-supported roulette bet types for placement", () => {
    expect(() => validateRouletteBetInput(RouletteBetType.EVEN)).toThrow(/Unsupported betType/);
  });
});
