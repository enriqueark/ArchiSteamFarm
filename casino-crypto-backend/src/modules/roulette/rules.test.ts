import { RouletteBetType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { ROULETTE_TOTAL_OUTCOMES, evaluateRouletteBet, getRouletteProbabilityModel } from "./rules";

const ROULETTE_BET_TYPES: RouletteBetType[] = [
  RouletteBetType.STRAIGHT,
  RouletteBetType.RED,
  RouletteBetType.BLACK,
  RouletteBetType.EVEN,
  RouletteBetType.ODD,
  RouletteBetType.LOW,
  RouletteBetType.HIGH,
  RouletteBetType.DOZEN_1,
  RouletteBetType.DOZEN_2,
  RouletteBetType.DOZEN_3
];

const EXPECTED_WINNING_OUTCOMES: Record<RouletteBetType, number> = {
  [RouletteBetType.STRAIGHT]: 1,
  [RouletteBetType.RED]: 18,
  [RouletteBetType.BLACK]: 18,
  [RouletteBetType.EVEN]: 18,
  [RouletteBetType.ODD]: 18,
  [RouletteBetType.LOW]: 18,
  [RouletteBetType.HIGH]: 18,
  [RouletteBetType.DOZEN_1]: 12,
  [RouletteBetType.DOZEN_2]: 12,
  [RouletteBetType.DOZEN_3]: 12
};

const EXPECTED_PAYOUT_MULTIPLIER: Record<RouletteBetType, number> = {
  [RouletteBetType.STRAIGHT]: 36,
  [RouletteBetType.RED]: 2,
  [RouletteBetType.BLACK]: 2,
  [RouletteBetType.EVEN]: 2,
  [RouletteBetType.ODD]: 2,
  [RouletteBetType.LOW]: 2,
  [RouletteBetType.HIGH]: 2,
  [RouletteBetType.DOZEN_1]: 3,
  [RouletteBetType.DOZEN_2]: 3,
  [RouletteBetType.DOZEN_3]: 3
};

const countWinningOutcomes = (betType: RouletteBetType, betValue?: number): number => {
  let wins = 0;

  for (let winningNumber = 0; winningNumber < ROULETTE_TOTAL_OUTCOMES; winningNumber += 1) {
    if (evaluateRouletteBet(betType, winningNumber, betValue).won) {
      wins += 1;
    }
  }

  return wins;
};

describe("roulette payout math", () => {
  it("keeps straight bets at exactly one winning outcome for every number", () => {
    for (let betValue = 0; betValue < ROULETTE_TOTAL_OUTCOMES; betValue += 1) {
      expect(countWinningOutcomes(RouletteBetType.STRAIGHT, betValue)).toBe(1);
    }
  });

  it("matches theoretical winning outcome counts for every bet type", () => {
    for (const betType of ROULETTE_BET_TYPES) {
      const betValue = betType === RouletteBetType.STRAIGHT ? 17 : undefined;
      expect(countWinningOutcomes(betType, betValue)).toBe(EXPECTED_WINNING_OUTCOMES[betType]);
    }
  });

  it("matches expected payout multipliers and EV for European single-zero roulette", () => {
    const model = getRouletteProbabilityModel();

    expect(model.wheelType).toBe("EUROPEAN_SINGLE_ZERO");
    expect(model.totalOutcomes).toBe(ROULETTE_TOTAL_OUTCOMES);
    expect(model.bets).toHaveLength(ROULETTE_BET_TYPES.length);

    for (const bet of model.bets) {
      expect(bet.totalOutcomes).toBe(ROULETTE_TOTAL_OUTCOMES);
      expect(bet.winningOutcomes).toBe(EXPECTED_WINNING_OUTCOMES[bet.betType]);
      expect(bet.winningOutcomes + bet.losingOutcomes).toBe(ROULETTE_TOTAL_OUTCOMES);
      expect(bet.payoutMultiplier).toBe(EXPECTED_PAYOUT_MULTIPLIER[bet.betType]);

      // All implemented bets are calibrated to the same house edge: 1/37 ~= 2.70%.
      expect(bet.expectedReturn.numerator).toBe(36);
      expect(bet.expectedReturn.denominator).toBe(37);
      expect(bet.expectedReturn.value).toBeCloseTo(36 / 37, 12);
      expect(bet.expectedNet.numerator).toBe(-1);
      expect(bet.expectedNet.denominator).toBe(37);
      expect(bet.expectedNet.value).toBeCloseTo(-1 / 37, 12);
      expect(bet.houseEdge.numerator).toBe(1);
      expect(bet.houseEdge.denominator).toBe(37);
      expect(bet.houseEdge.value).toBeCloseTo(1 / 37, 12);
    }
  });
});
