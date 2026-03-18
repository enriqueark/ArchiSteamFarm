import { RouletteBetType } from "@prisma/client";

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 11, 13]);
const SUPPORTED_ROULETTE_BET_TYPES: RouletteBetType[] = [
  RouletteBetType.RED,
  RouletteBetType.BLACK,
  RouletteBetType.GREEN,
  RouletteBetType.BAIT
];

export const ROULETTE_MIN_NUMBER = 1;
export const ROULETTE_MAX_NUMBER = 15;
export const ROULETTE_TOTAL_OUTCOMES = ROULETTE_MAX_NUMBER - ROULETTE_MIN_NUMBER + 1;
export const ROULETTE_GREEN_NUMBER = 15;
export const ROULETTE_BAIT_LEFT_NUMBER = 14;
export const ROULETTE_BAIT_RIGHT_NUMBER = 1;

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
  wheelType: "CUSTOM_FIFTEEN_SLOT";
  totalOutcomes: number;
  greenNumber: number;
  baitNumbers: number[];
  bets: RouletteBetProbabilityModel[];
};

const getColor = (winningNumber: number): "GREEN" | "RED" | "BLACK" => {
  if (winningNumber === ROULETTE_GREEN_NUMBER) {
    return "GREEN";
  }

  if (winningNumber < ROULETTE_MIN_NUMBER || winningNumber > ROULETTE_MAX_NUMBER) {
    throw new Error(`Invalid roulette winning number: ${winningNumber}`);
  }

  return RED_NUMBERS.has(winningNumber) ? "RED" : "BLACK";
};

const toFractionModel = (numerator: number, denominator: number): FractionModel => ({
  numerator,
  denominator,
  value: numerator / denominator
});

export const isRouletteBaitNumber = (winningNumber: number): boolean =>
  winningNumber === ROULETTE_BAIT_LEFT_NUMBER || winningNumber === ROULETTE_BAIT_RIGHT_NUMBER;

const getPayoutMultiplier = (betType: RouletteBetType): number => {
  switch (betType) {
    case RouletteBetType.RED:
    case RouletteBetType.BLACK:
      return 2;
    case RouletteBetType.GREEN:
      return 14;
    case RouletteBetType.BAIT:
      return 7;
    default:
      return 0;
  }
};

const isWinningRouletteBet = (betType: RouletteBetType, winningNumber: number, _betValue?: number): boolean => {
  const color = getColor(winningNumber);

  switch (betType) {
    case RouletteBetType.RED:
      return color === "RED";
    case RouletteBetType.BLACK:
      return color === "BLACK";
    case RouletteBetType.GREEN:
      return winningNumber === ROULETTE_GREEN_NUMBER;
    case RouletteBetType.BAIT:
      return isRouletteBaitNumber(winningNumber);
    default:
      // Legacy bet types remain in enum for compatibility but are disabled in this wheel mode.
      return false;
  }
};

export const getRouletteColor = (winningNumber: number): "GREEN" | "RED" | "BLACK" => getColor(winningNumber);

export const validateRouletteBetInput = (betType: RouletteBetType, betValue?: number): void => {
  if (!SUPPORTED_ROULETTE_BET_TYPES.includes(betType)) {
    throw new Error(
      `Unsupported roulette betType for 15-slot wheel. Allowed: ${SUPPORTED_ROULETTE_BET_TYPES.join(", ")}`
    );
  }

  if (typeof betValue !== "undefined" && betValue !== null) {
    throw new Error(`${betType} does not accept betValue in 15-slot wheel mode`);
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
  let wins = 0;

  for (let winningNumber = ROULETTE_MIN_NUMBER; winningNumber <= ROULETTE_MAX_NUMBER; winningNumber += 1) {
    if (isWinningRouletteBet(betType, winningNumber)) {
      wins += 1;
    }
  }

  return wins;
};

export const getRouletteProbabilityModel = (): RouletteProbabilityModel => {
  const bets = SUPPORTED_ROULETTE_BET_TYPES.map((betType) => {
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
    wheelType: "CUSTOM_FIFTEEN_SLOT",
    totalOutcomes: ROULETTE_TOTAL_OUTCOMES,
    greenNumber: ROULETTE_GREEN_NUMBER,
    baitNumbers: [ROULETTE_BAIT_LEFT_NUMBER, ROULETTE_BAIT_RIGHT_NUMBER],
    bets
  };
};
