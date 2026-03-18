import { RouletteBetType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  ROULETTE_BAIT_LEFT_NUMBER,
  ROULETTE_BAIT_RIGHT_NUMBER,
  ROULETTE_GREEN_NUMBER,
  ROULETTE_MAX_NUMBER,
  ROULETTE_MIN_NUMBER,
  ROULETTE_TOTAL_OUTCOMES,
  evaluateRouletteBet,
  getRouletteColor,
  getRouletteProbabilityModel,
  isRouletteBaitNumber
} from "./rules";

const SUPPORTED_BET_TYPES: RouletteBetType[] = [
  RouletteBetType.RED,
  RouletteBetType.BLACK,
  RouletteBetType.GREEN,
  RouletteBetType.BAIT
];

const EXPECTED_WINNING_OUTCOMES: Record<RouletteBetType, number> = {
  [RouletteBetType.RED]: 7,
  [RouletteBetType.BLACK]: 7,
  [RouletteBetType.GREEN]: 1,
  [RouletteBetType.BAIT]: 2,
  [RouletteBetType.STRAIGHT]: 0,
  [RouletteBetType.EVEN]: 0,
  [RouletteBetType.ODD]: 0,
  [RouletteBetType.LOW]: 0,
  [RouletteBetType.HIGH]: 0,
  [RouletteBetType.DOZEN_1]: 0,
  [RouletteBetType.DOZEN_2]: 0,
  [RouletteBetType.DOZEN_3]: 0
};

const EXPECTED_PAYOUT_MULTIPLIER: Record<RouletteBetType, number> = {
  [RouletteBetType.RED]: 2,
  [RouletteBetType.BLACK]: 2,
  [RouletteBetType.GREEN]: 14,
  [RouletteBetType.BAIT]: 7,
  [RouletteBetType.STRAIGHT]: 0,
  [RouletteBetType.EVEN]: 0,
  [RouletteBetType.ODD]: 0,
  [RouletteBetType.LOW]: 0,
  [RouletteBetType.HIGH]: 0,
  [RouletteBetType.DOZEN_1]: 0,
  [RouletteBetType.DOZEN_2]: 0,
  [RouletteBetType.DOZEN_3]: 0
};

const countWinningOutcomes = (betType: RouletteBetType): number => {
  let wins = 0;

  for (let winningNumber = ROULETTE_MIN_NUMBER; winningNumber <= ROULETTE_MAX_NUMBER; winningNumber += 1) {
    if (evaluateRouletteBet(betType, winningNumber).won) {
      wins += 1;
    }
  }

  return wins;
};

describe("roulette payout math", () => {
  it("builds a 15-slot wheel with 7 reds, 7 blacks and 1 green", () => {
    let redCount = 0;
    let blackCount = 0;
    let greenCount = 0;

    for (let winningNumber = ROULETTE_MIN_NUMBER; winningNumber <= ROULETTE_MAX_NUMBER; winningNumber += 1) {
      const color = getRouletteColor(winningNumber);
      if (color === "RED") {
        redCount += 1;
      } else if (color === "BLACK") {
        blackCount += 1;
      } else {
        greenCount += 1;
      }
    }

    expect(ROULETTE_TOTAL_OUTCOMES).toBe(15);
    expect(redCount).toBe(7);
    expect(blackCount).toBe(7);
    expect(greenCount).toBe(1);
    expect(ROULETTE_GREEN_NUMBER).toBe(15);

    const leftColor = getRouletteColor(ROULETTE_BAIT_LEFT_NUMBER);
    const rightColor = getRouletteColor(ROULETTE_BAIT_RIGHT_NUMBER);
    expect([leftColor, rightColor]).toContain("RED");
    expect([leftColor, rightColor]).toContain("BLACK");
  });

  it("activates BAIT only on left/right neighbors of green", () => {
    expect(isRouletteBaitNumber(ROULETTE_BAIT_LEFT_NUMBER)).toBe(true);
    expect(isRouletteBaitNumber(ROULETTE_BAIT_RIGHT_NUMBER)).toBe(true);
    expect(isRouletteBaitNumber(ROULETTE_GREEN_NUMBER)).toBe(false);

    for (let winningNumber = ROULETTE_MIN_NUMBER; winningNumber <= ROULETTE_MAX_NUMBER; winningNumber += 1) {
      const shouldBeBait = winningNumber === ROULETTE_BAIT_LEFT_NUMBER || winningNumber === ROULETTE_BAIT_RIGHT_NUMBER;
      expect(evaluateRouletteBet(RouletteBetType.BAIT, winningNumber).won).toBe(shouldBeBait);
    }
  });

  it("matches theoretical winning outcome counts, multipliers and EV", () => {
    const model = getRouletteProbabilityModel();

    expect(model.wheelType).toBe("CUSTOM_FIFTEEN_SLOT");
    expect(model.totalOutcomes).toBe(ROULETTE_TOTAL_OUTCOMES);
    expect(model.greenNumber).toBe(ROULETTE_GREEN_NUMBER);
    expect(model.baitNumbers).toEqual([ROULETTE_BAIT_LEFT_NUMBER, ROULETTE_BAIT_RIGHT_NUMBER]);
    expect(model.bets).toHaveLength(SUPPORTED_BET_TYPES.length);

    for (const betType of SUPPORTED_BET_TYPES) {
      expect(countWinningOutcomes(betType)).toBe(EXPECTED_WINNING_OUTCOMES[betType]);
      const sample = evaluateRouletteBet(betType, ROULETTE_BAIT_LEFT_NUMBER);
      expect(sample.payoutMultiplier).toBe(EXPECTED_PAYOUT_MULTIPLIER[betType]);
    }

    for (const bet of model.bets) {
      expect(bet.totalOutcomes).toBe(ROULETTE_TOTAL_OUTCOMES);
      expect(bet.winningOutcomes).toBe(EXPECTED_WINNING_OUTCOMES[bet.betType]);
      expect(bet.winningOutcomes + bet.losingOutcomes).toBe(ROULETTE_TOTAL_OUTCOMES);
      expect(bet.payoutMultiplier).toBe(EXPECTED_PAYOUT_MULTIPLIER[bet.betType]);

      // All supported bets are calibrated to the same house edge: 1/15 ~= 6.67%.
      expect(bet.expectedReturn.numerator).toBe(14);
      expect(bet.expectedReturn.denominator).toBe(15);
      expect(bet.expectedReturn.value).toBeCloseTo(14 / 15, 12);
      expect(bet.expectedNet.numerator).toBe(-1);
      expect(bet.expectedNet.denominator).toBe(15);
      expect(bet.expectedNet.value).toBeCloseTo(-1 / 15, 12);
      expect(bet.houseEdge.numerator).toBe(1);
      expect(bet.houseEdge.denominator).toBe(15);
      expect(bet.houseEdge.value).toBeCloseTo(1 / 15, 12);
    }
  });
});
