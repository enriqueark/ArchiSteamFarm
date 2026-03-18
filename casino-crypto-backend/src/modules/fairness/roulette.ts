import { Currency } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

import { redis } from "../../infrastructure/redis/client";
import { SUPPORTED_CURRENCIES } from "../wallets/service";
import { computeRouletteFairHash, hashToRouletteWinningNumber } from "./hash";

const ROULETTE_FAIR_STATE_KEY = "fair:roulette:active-state";
const ROULETTE_FAIR_REVEALED_LIST_KEY = "fair:roulette:revealed-seeds";
const ROULETTE_FAIR_RECENT_PROOFS_KEY = "fair:roulette:recent-proofs";
const ROULETTE_FAIR_REVEALED_MAX_ITEMS = 20;
const ROULETTE_FAIR_RECENT_PROOFS_MAX_ITEMS = 200;

type RouletteFairState = {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  rotatedAt: string;
};

export type RouletteFairProof = {
  roundId: string;
  currency: Currency;
  winningNumber: number;
  nonce: number;
  hash: string;
  serverSeedHash: string;
  clientSeed: string;
  generatedAt: string;
};

const randomSeed = (): string => randomBytes(32).toString("hex");
const hashSeed = (seed: string): string => createHash("sha256").update(seed).digest("hex");

const toRouletteFairState = (raw: string | null): RouletteFairState | null => {
  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as RouletteFairState;
};

const createInitialState = (): RouletteFairState => {
  const serverSeed = randomSeed();
  return {
    serverSeed,
    serverSeedHash: hashSeed(serverSeed),
    clientSeed: randomSeed(),
    nonce: 0,
    rotatedAt: new Date().toISOString()
  };
};

export const ensureRouletteFairState = async (): Promise<RouletteFairState> => {
  const existing = toRouletteFairState(await redis.get(ROULETTE_FAIR_STATE_KEY));
  if (existing) {
    return existing;
  }

  const initial = createInitialState();
  await redis.set(ROULETTE_FAIR_STATE_KEY, JSON.stringify(initial));
  return initial;
};

export const getRouletteFairPublicState = async (): Promise<{
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  rotatedAt: string;
  revealedSeeds: Array<{ serverSeed: string; serverSeedHash: string; rotatedAt: string }>;
  recentProofs: RouletteFairProof[];
  currencies: Currency[];
}> => {
  const state = await ensureRouletteFairState();
  const [revealedRaw, recentProofsRaw] = await Promise.all([
    redis.lrange(ROULETTE_FAIR_REVEALED_LIST_KEY, 0, ROULETTE_FAIR_REVEALED_MAX_ITEMS - 1),
    redis.lrange(ROULETTE_FAIR_RECENT_PROOFS_KEY, 0, 49)
  ]);

  return {
    serverSeedHash: state.serverSeedHash,
    clientSeed: state.clientSeed,
    nonce: state.nonce,
    rotatedAt: state.rotatedAt,
    revealedSeeds: revealedRaw.map((entry) => JSON.parse(entry) as { serverSeed: string; serverSeedHash: string; rotatedAt: string }),
    recentProofs: recentProofsRaw.map((entry) => JSON.parse(entry) as RouletteFairProof),
    currencies: SUPPORTED_CURRENCIES
  };
};

export const rotateRouletteFairSeed = async (): Promise<{
  revealedServerSeed: string;
  revealedServerSeedHash: string;
  newServerSeedHash: string;
  nonce: number;
}> => {
  const current = await ensureRouletteFairState();
  const next = createInitialState();

  const pipeline = redis.pipeline();
  pipeline.set(ROULETTE_FAIR_STATE_KEY, JSON.stringify(next));
  pipeline.lpush(
    ROULETTE_FAIR_REVEALED_LIST_KEY,
    JSON.stringify({
      serverSeed: current.serverSeed,
      serverSeedHash: current.serverSeedHash,
      rotatedAt: current.rotatedAt
    })
  );
  pipeline.ltrim(ROULETTE_FAIR_REVEALED_LIST_KEY, 0, ROULETTE_FAIR_REVEALED_MAX_ITEMS - 1);
  await pipeline.exec();

  return {
    revealedServerSeed: current.serverSeed,
    revealedServerSeedHash: current.serverSeedHash,
    newServerSeedHash: next.serverSeedHash,
    nonce: next.nonce
  };
};

export const drawRouletteProvablyFairOutcome = async (input: {
  minNumber: number;
  maxNumber: number;
  roundId: string;
  currency: Currency;
}): Promise<{ winningNumber: number; proof: RouletteFairProof }> => {
  const state = await ensureRouletteFairState();
  const hash = computeRouletteFairHash(state.serverSeed, state.clientSeed, state.nonce);
  const winningNumber = hashToRouletteWinningNumber(hash, input.minNumber, input.maxNumber);

  const proof: RouletteFairProof = {
    roundId: input.roundId,
    currency: input.currency,
    winningNumber,
    nonce: state.nonce,
    hash,
    serverSeedHash: state.serverSeedHash,
    clientSeed: state.clientSeed,
    generatedAt: new Date().toISOString()
  };

  const nextState: RouletteFairState = {
    ...state,
    nonce: state.nonce + 1
  };

  const pipeline = redis.pipeline();
  pipeline.set(ROULETTE_FAIR_STATE_KEY, JSON.stringify(nextState));
  pipeline.lpush(ROULETTE_FAIR_RECENT_PROOFS_KEY, JSON.stringify(proof));
  pipeline.ltrim(ROULETTE_FAIR_RECENT_PROOFS_KEY, 0, ROULETTE_FAIR_RECENT_PROOFS_MAX_ITEMS - 1);
  await pipeline.exec();

  return {
    winningNumber,
    proof
  };
};
