import { Currency, RouletteBetType, RouletteRoundStatus } from "@prisma/client";

import { redis } from "../../infrastructure/redis/client";

const ROUND_STATE_TTL_SECONDS = 60 * 15;
const ACTIVE_BET_TTL_SECONDS = 60 * 30;

export type RouletteRoundPhase = "BETTING" | "SPINNING" | "RESULT";

export type RouletteSharedRoundState = {
  roundId: string;
  roundNumber: number;
  currency: Currency;
  status: RouletteRoundStatus;
  phase: RouletteRoundPhase;
  openAt: string;
  betsCloseAt: string;
  spinStartsAt: string;
  settleAt: string;
  winningNumber: number | null;
  winningColor: string | null;
  winningIsBait: boolean | null;
  totalStakedAtomic: string;
  totalPayoutAtomic: string;
  updatedAt: string;
};

type ActiveBetPayload = {
  roundId: string;
  betId: string;
  userId: string;
  currency: Currency;
  betType: RouletteBetType;
  stakeAtomic: string;
  createdAt: string;
};

const roundStateKey = (currency: Currency): string => `roulette:state:currency:${currency}`;
const roundActiveBetsSetKey = (roundId: string): string => `roulette:round:${roundId}:active-bets`;
const roundActiveBetKey = (roundId: string, betId: string): string => `roulette:round:${roundId}:active-bet:${betId}`;

export const toRoulettePhase = (status: RouletteRoundStatus): RouletteRoundPhase => {
  switch (status) {
    case RouletteRoundStatus.SPINNING:
      return "SPINNING";
    case RouletteRoundStatus.SETTLED:
      return "RESULT";
    case RouletteRoundStatus.OPEN:
    case RouletteRoundStatus.CLOSED:
    case RouletteRoundStatus.CANCELLED:
    default:
      return "BETTING";
  }
};

export const persistRouletteRoundState = async (state: RouletteSharedRoundState): Promise<void> => {
  await redis.set(roundStateKey(state.currency), JSON.stringify(state), "EX", ROUND_STATE_TTL_SECONDS);
};

export const getPersistedRouletteRoundState = async (currency: Currency): Promise<RouletteSharedRoundState | null> => {
  const raw = await redis.get(roundStateKey(currency));
  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as RouletteSharedRoundState;
};

export const trackActiveRouletteBet = async (payload: ActiveBetPayload): Promise<void> => {
  const setKey = roundActiveBetsSetKey(payload.roundId);
  const betKey = roundActiveBetKey(payload.roundId, payload.betId);
  const pipeline = redis.pipeline();

  pipeline.sadd(setKey, payload.betId);
  pipeline.expire(setKey, ACTIVE_BET_TTL_SECONDS);
  pipeline.set(betKey, JSON.stringify(payload), "EX", ACTIVE_BET_TTL_SECONDS);

  await pipeline.exec();
};

export const settleActiveRouletteBet = async (roundId: string, betId: string): Promise<void> => {
  const setKey = roundActiveBetsSetKey(roundId);
  const betKey = roundActiveBetKey(roundId, betId);
  const pipeline = redis.pipeline();
  pipeline.srem(setKey, betId);
  pipeline.del(betKey);
  await pipeline.exec();
};

export const getActiveRouletteBetCount = async (roundId: string): Promise<number> => redis.scard(roundActiveBetsSetKey(roundId));
