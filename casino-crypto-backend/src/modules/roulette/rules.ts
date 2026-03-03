import { RouletteBetType } from "@prisma/client";

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
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

export const ROULETTE_TOTAL_OUTCOMES = 37;

type FractionModel = {
  numerator: number;
  denominator: number;
  value: number;
};

export type RouletteBetProbabilityModel = {
  betType: RouletteBetType;
  payoutMultiplier: number;
  totalOutcomes: number;
  winningOutcomes: number;
  losingOutcomes: number;
  winProbability: FractionModel;
  expectedReturn: FractionModel;
  expectedNet: FractionModel;
  houseEdge: FractionModel;
};

export type RouletteProbabilityModel = {
  wheelType: "EUROPEAN_SINGLE_ZERO";
  totalOutcomes: number;
  bets: RouletteBetProbabilityModel[];
};

const getColor = (winningNumber: number): "GREEN" | "RED" | "BLACK" => {
  if (winningNumber === 0) {
    return "GREEN";
  }

  return RED_NUMBERS.has(winningNumber) ? "RED" : "BLACK";
};

const toFractionModel = (numerator: number, denominator: number): FractionModel => ({
  numerator,
  denominator,
  value: numerator / denominator
});

const getPayoutMultiplier = (betType: RouletteBetType): number => {
  switch (betType) {
    case RouletteBetType.STRAIGHT:
      return 36;
    case RouletteBetType.RED:
    case RouletteBetType.BLACK:
    case RouletteBetType.EVEN:
    case RouletteBetType.ODD:
    case RouletteBetType.LOW:
    case RouletteBetType.HIGH:
      return 2;
    case RouletteBetType.DOZEN_1:
    case RouletteBetType.DOZEN_2:
    case RouletteBetType.DOZEN_3:
      return 3;
    default: {
      const unsupportedBetType: never = betType;
      throw new Error(`Unsupported roulette bet type: ${unsupportedBetType}`);
    }
  }
};

const isWinningRouletteBet = (betType: RouletteBetType, winningNumber: number, betValue?: number): boolean => {
  const color = getColor(winningNumber);

  switch (betType) {
    case RouletteBetType.STRAIGHT:
      return typeof betValue === "number" && winningNumber === betValue;
    case RouletteBetType.RED:
      return color === "RED";
    case RouletteBetType.BLACK:
      return color === "BLACK";
    case RouletteBetType.EVEN:
      return winningNumber !== 0 && winningNumber % 2 === 0;
    case RouletteBetType.ODD:
      return winningNumber % 2 === 1;
    case RouletteBetType.LOW:
      return winningNumber >= 1 && winningNumber <= 18;
    case RouletteBetType.HIGH:
      return winningNumber >= 19 && winningNumber <= 36;
    case RouletteBetType.DOZEN_1:
      return winningNumber >= 1 && winningNumber <= 12;
    case RouletteBetType.DOZEN_2:
      return winningNumber >= 13 && winningNumber <= 24;
    case RouletteBetType.DOZEN_3:
      return winningNumber >= 25 && winningNumber <= 36;
    default: {
      const unsupportedBetType: never = betType;
      throw new Error(`Unsupported roulette bet type: ${unsupportedBetType}`);
    }
  }
};

export const getRouletteColor = (winningNumber: number): "GREEN" | "RED" | "BLACK" => getColor(winningNumber);

export const validateRouletteBetInput = (betType: RouletteBetType, betValue?: number): void => {
  if (betType === RouletteBetType.STRAIGHT) {
    const value = betValue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 36) {
      throw new Error("STRAIGHT bet requires betValue between 0 and 36");
    }
    return;
  }

  if (typeof betValue !== "undefined") {
    throw new Error(`${betType} bet does not accept betValue`);
  }
};

export const evaluateRouletteBet = (
  betType: RouletteBetType,
  winningNumber: number,
  betValue?: number
): { won: boolean; payoutMultiplier: number } => {
  return {
    won: isWinningRouletteBet(betType, winningNumber, betValue),
    payoutMultiplier: getPayoutMultiplier(betType)
  };
};

export const computePayoutAtomic = (stakeAtomic: bigint, payoutMultiplier: number): bigint =>
  stakeAtomic * BigInt(payoutMultiplier);

const countWinningOutcomes = (betType: RouletteBetType): number => {
  const modelBetValue = betType === RouletteBetType.STRAIGHT ? 0 : undefined;
  let wins = 0;

  for (let winningNumber = 0; winningNumber < ROULETTE_TOTAL_OUTCOMES; winningNumber += 1) {
    if (isWinningRouletteBet(betType, winningNumber, modelBetValue)) {
      wins += 1;
    }
  }

  return wins;
};

export const getRouletteProbabilityModel = (): RouletteProbabilityModel => {
  const bets = ROULETTE_BET_TYPES.map((betType) => {
    const payoutMultiplier = getPayoutMultiplier(betType);
    const winningOutcomes = countWinningOutcomes(betType);
    const losingOutcomes = ROULETTE_TOTAL_OUTCOMES - winningOutcomes;
    const expectedReturnNumerator = winningOutcomes * payoutMultiplier;
    const expectedNetNumerator = expectedReturnNumerator - ROULETTE_TOTAL_OUTCOMES;

    return {
      betType,
      payoutMultiplier,
      totalOutcomes: ROULETTE_TOTAL_OUTCOMES,
      winningOutcomes,
      losingOutcomes,
      winProbability: toFractionModel(winningOutcomes, ROULETTE_TOTAL_OUTCOMES),
      expectedReturn: toFractionModel(expectedReturnNumerator, ROULETTE_TOTAL_OUTCOMES),
      expectedNet: toFractionModel(expectedNetNumerator, ROULETTE_TOTAL_OUTCOMES),
      houseEdge: toFractionModel(-expectedNetNumerator, ROULETTE_TOTAL_OUTCOMES)
    } satisfies RouletteBetProbabilityModel;
  });

  return {
    wheelType: "EUROPEAN_SINGLE_ZERO",
    totalOutcomes: ROULETTE_TOTAL_OUTCOMES,
    bets
  };
};
