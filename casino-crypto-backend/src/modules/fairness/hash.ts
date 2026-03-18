import { createHash } from "node:crypto";

export const computeRouletteFairHash = (serverSeed: string, clientSeed: string, nonce: number): string =>
  createHash("sha256").update(`${serverSeed}:${clientSeed}:${nonce}`).digest("hex");

export const hashToRouletteWinningNumber = (hash: string, minNumber: number, maxNumber: number): number => {
  const totalOutcomes = maxNumber - minNumber + 1;
  const randomInt = Number(BigInt(`0x${hash.slice(0, 14)}`) % BigInt(totalOutcomes));
  return minNumber + randomInt;
};
