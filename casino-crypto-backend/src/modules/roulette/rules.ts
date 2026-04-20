import { RouletteBetType } from "@prisma/client";

export const ROULETTE_MIN_NUMBER = 0;
export const ROULETTE_MAX_NUMBER = 14;
export const ROULETTE_GREEN_NUMBER = 0;
export const ROULETTE_BAIT_LEFT_NUMBER = 14;
export const ROULETTE_BAIT_RIGHT_NUMBER = 1;
export const ROULETTE_ALLOWED_BET_TYPES = [
  RouletteBetType.RED,
  RouletteBetType.BLACK,
  RouletteBetType.GREEN,
  RouletteBetType.BAIT
] as const;
const ALLOWED_BET_TYPE_SET = new Set<RouletteBetType>(ROULETTE_ALLOWED_BET_TYPES);

// 15-slot custom wheel: 7 red, 7 black, 1 green.
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 11, 13]);

const getColor = (winningNumber: number): "GREEN" | "RED" | "BLACK" => {
  if (winningNumber === ROULETTE_GREEN_NUMBER) {
    return "GREEN";
  }

  return RED_NUMBERS.has(winningNumber) ? "RED" : "BLACK";
};

export const getRouletteColor = (winningNumber: number): "GREEN" | "RED" | "BLACK" => getColor(winningNumber);

export const validateRouletteBetInput = (betType: RouletteBetType, betValue?: number): void => {
  if (!ALLOWED_BET_TYPE_SET.has(betType)) {
    throw new Error("Unsupported betType. Allowed: RED, BLACK, GREEN, BAIT");
  }

  if (typeof betValue !== "undefined") {
    throw new Error(`${betType} bet does not accept betValue`);
  }
};

export const evaluateRouletteBet = (
  betType: RouletteBetType,
  winningNumber: number,
  _betValue?: number
): { won: boolean; payoutMultiplier: number } => {
  const color = getColor(winningNumber);

  switch (betType) {
    case RouletteBetType.RED:
      return { won: color === "RED", payoutMultiplier: 2 };
    case RouletteBetType.BLACK:
      return { won: color === "BLACK", payoutMultiplier: 2 };
    case RouletteBetType.GREEN:
      return { won: winningNumber === ROULETTE_GREEN_NUMBER, payoutMultiplier: 14 };
    case RouletteBetType.BAIT:
      return {
        won: winningNumber === ROULETTE_BAIT_LEFT_NUMBER || winningNumber === ROULETTE_BAIT_RIGHT_NUMBER,
        payoutMultiplier: 7
      };
    default:
      return { won: false, payoutMultiplier: 0 };
  }
};

export const computePayoutAtomic = (stakeAtomic: bigint, payoutMultiplier: number): bigint =>
  stakeAtomic * BigInt(payoutMultiplier);
