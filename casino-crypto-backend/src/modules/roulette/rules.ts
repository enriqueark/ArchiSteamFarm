import { RouletteBetType } from "@prisma/client";

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const getColor = (winningNumber: number): "GREEN" | "RED" | "BLACK" => {
  if (winningNumber === 0) {
    return "GREEN";
  }

  return RED_NUMBERS.has(winningNumber) ? "RED" : "BLACK";
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
  const color = getColor(winningNumber);

  switch (betType) {
    case RouletteBetType.STRAIGHT:
      return {
        won: typeof betValue === "number" && winningNumber === betValue,
        payoutMultiplier: 36
      };
    case RouletteBetType.RED:
      return { won: color === "RED", payoutMultiplier: 2 };
    case RouletteBetType.BLACK:
      return { won: color === "BLACK", payoutMultiplier: 2 };
    case RouletteBetType.EVEN:
      return { won: winningNumber !== 0 && winningNumber % 2 === 0, payoutMultiplier: 2 };
    case RouletteBetType.ODD:
      return { won: winningNumber % 2 === 1, payoutMultiplier: 2 };
    case RouletteBetType.LOW:
      return { won: winningNumber >= 1 && winningNumber <= 18, payoutMultiplier: 2 };
    case RouletteBetType.HIGH:
      return { won: winningNumber >= 19 && winningNumber <= 36, payoutMultiplier: 2 };
    case RouletteBetType.DOZEN_1:
      return { won: winningNumber >= 1 && winningNumber <= 12, payoutMultiplier: 3 };
    case RouletteBetType.DOZEN_2:
      return { won: winningNumber >= 13 && winningNumber <= 24, payoutMultiplier: 3 };
    case RouletteBetType.DOZEN_3:
      return { won: winningNumber >= 25 && winningNumber <= 36, payoutMultiplier: 3 };
    default:
      return { won: false, payoutMultiplier: 0 };
  }
};

export const computePayoutAtomic = (stakeAtomic: bigint, payoutMultiplier: number): bigint =>
  stakeAtomic * BigInt(payoutMultiplier);
