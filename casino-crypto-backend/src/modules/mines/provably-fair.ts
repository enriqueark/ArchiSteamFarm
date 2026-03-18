import { createHash, randomBytes, randomUUID } from "node:crypto";

const RNG_BYTES = 6;
const RNG_MAX = 2 ** (RNG_BYTES * 8);

export const BOARD_SIZE = 25;
export const MIN_MINES = 1;
export const MAX_MINES = BOARD_SIZE - 1;
export const HOUSE_EDGE = 0.01;
export const SINGLE_MINE_BREAK_EVEN_SAFE_REVEALS = 3;
export const BREAK_EVEN_REFERENCE_MINE_COUNT = 1;

export const generateServerSeed = (): string => randomBytes(32).toString("hex");

export const generateClientSeed = (): string => randomUUID();

export const hashServerSeed = (serverSeed: string): string =>
  createHash("sha256").update(serverSeed).digest("hex");

export const computeFairHash = (serverSeed: string, clientSeed: string, nonce: number): string =>
  createHash("sha256").update(`${serverSeed}:${clientSeed}:${nonce}`).digest("hex");

const deterministicRandom = (serverSeed: string, clientSeed: string, nonce: number, round: number): number => {
  const digest = createHash("sha256").update(`${serverSeed}:${clientSeed}:${nonce}:${round}`).digest();
  const int = digest.readUIntBE(0, RNG_BYTES);
  return int / RNG_MAX;
};

export const buildMineIndexes = (
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  mineCount: number,
  boardSize = BOARD_SIZE
): number[] => {
  const pool = Array.from({ length: boardSize }, (_, idx) => idx);
  let round = 0;

  for (let i = pool.length - 1; i > 0; i -= 1) {
    const rand = deterministicRandom(serverSeed, clientSeed, nonce, round);
    const j = Math.floor(rand * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    round += 1;
  }

  return pool.slice(0, mineCount).sort((a, b) => a - b);
};

const calculateBaseMultiplier = (
  mineCount: number,
  safeReveals: number,
  boardSize = BOARD_SIZE,
  houseEdge = HOUSE_EDGE
): number => {
  const safeCells = boardSize - mineCount;
  if (safeCells <= 0 || safeReveals > safeCells) {
    throw new Error("Invalid mines configuration for multiplier calculation");
  }

  let multiplier = 1;
  for (let i = 0; i < safeReveals; i += 1) {
    const remainingTiles = boardSize - i;
    const remainingSafeTiles = safeCells - i;
    multiplier *= remainingTiles / remainingSafeTiles;
  }

  return multiplier * (1 - houseEdge);
};

export const calculateMultiplier = (
  mineCount: number,
  safeReveals: number,
  boardSize = BOARD_SIZE,
  houseEdge = HOUSE_EDGE
): number => {
  if (safeReveals <= 0) {
    return 1;
  }

  const baseMultiplier = calculateBaseMultiplier(mineCount, safeReveals, boardSize, houseEdge);
  const safeCellsForReference = boardSize - BREAK_EVEN_REFERENCE_MINE_COUNT;
  const breakEvenReveals = Math.min(SINGLE_MINE_BREAK_EVEN_SAFE_REVEALS, safeCellsForReference);
  const breakEvenBaseMultiplier = calculateBaseMultiplier(
    BREAK_EVEN_REFERENCE_MINE_COUNT,
    breakEvenReveals,
    boardSize,
    houseEdge
  );

  // Global anti-abuse normalization for every mineCount:
  // (mineCount=1, safeReveals=3) is x1, and equivalent risk points align to that baseline.
  return Number((baseMultiplier / breakEvenBaseMultiplier).toFixed(8));
};

export const toScaledMultiplier = (multiplier: number): bigint => {
  const scale = 100_000_000;
  return BigInt(Math.floor(multiplier * scale));
};

export const calculatePayoutAtomic = (betAtomic: bigint, multiplier: number): bigint => {
  const scale = 100_000_000n;
  const scaledMultiplier = toScaledMultiplier(multiplier);
  return (betAtomic * scaledMultiplier) / scale;
};
