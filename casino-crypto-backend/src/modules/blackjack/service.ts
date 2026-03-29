import {
  BetReservationStatus,
  Currency,
  LedgerDirection,
  LedgerReason,
  Prisma
} from "@prisma/client";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";
import { enqueueAuditEvent } from "../../infrastructure/queue/audit-queue";
import { addUserXpBestEffort } from "../progression/service";
import {
  PLATFORM_INTERNAL_CURRENCY,
  MAX_GAME_BET_ATOMIC,
  debitBalanceInTx
} from "../wallets/service";
import { getBlackjackPayoutConfig } from "./config";

const SUITS = ["S", "H", "D", "C"] as const;
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

const INSURANCE_PAYOUT = 2n;
const STANDARD_PAYOUT = 2n;
type CardRank = (typeof RANKS)[number];
type CardSuit = (typeof SUITS)[number];
type CardCode = `${CardRank}${CardSuit}`;

type StoredHand = {
  cards: CardCode[];
  stakeAtomic: string;
  doubled: boolean;
  stood: boolean;
  busted: boolean;
  blackjack: boolean;
};

type StoredDeckState = {
  cards: CardCode[];
  cursor: number;
};

type StoredGameState = {
  playerHands: StoredHand[];
  dealerCards: CardCode[];
  deck: StoredDeckState;
};

type SidePayoutConfigNumeric = {
  pairsMultiplier: number;
  plus3Multiplier: number;
};

type WalletSnapshot = {
  walletId: string;
  balanceAtomic: bigint;
  lockedAtomic: bigint;
};

export type BlackjackGameState = {
  gameId: string;
  status: "ACTIVE" | "WON" | "LOST" | "PUSH" | "CANCELLED";
  currency: Currency;
  initialBetAtomic: bigint;
  mainBetAtomic: bigint;
  sideBetPairsAtomic: bigint;
  sideBet21Plus3Atomic: bigint;
  insuranceBetAtomic: bigint | null;
  canSplit: boolean;
  canInsurance: boolean;
  activeHandIndex: number;
  dealerRevealed: boolean;
  playerHands: Array<{
    cards: CardCode[];
    stakeAtomic: bigint;
    doubled: boolean;
    stood: boolean;
    busted: boolean;
    blackjack: boolean;
    value: number;
  }>;
  dealerCards: CardCode[];
  dealerVisibleCards: CardCode[];
  paytable: {
    pairsMultiplier: number;
    plus3Multiplier: number;
  };
  provablyFair: {
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
  };
  payoutAtomic: bigint | null;
  createdAt: Date;
  finishedAt: Date | null;
  wallet: WalletSnapshot;
};

type StartBlackjackInput = {
  userId: string;
  currency: Currency;
  betAtomic: bigint;
  sideBetPairsAtomic?: bigint;
  sideBet21Plus3Atomic?: bigint;
  idempotencyKey: string;
};

type PlayerActionInput = {
  userId: string;
  gameId: string;
  action: "HIT" | "STAND" | "DOUBLE" | "SPLIT" | "INSURANCE";
  idempotencyKey?: string;
};

type StartResult = {
  state: BlackjackGameState;
};

type GameToStateInput = {
  id: string;
  status: string;
  currency: Currency;
  initialBetAtomic: bigint;
  mainBetAtomic: bigint;
  sideBetPairsAtomic: bigint;
  sideBet21Plus3Atomic: bigint;
  insuranceBetAtomic: bigint | null;
  canSplit: boolean;
  canInsurance: boolean;
  activeHandIndex: number;
  dealerRevealed: boolean;
  playerHands: Prisma.JsonValue;
  dealerCards: Prisma.JsonValue;
  deck: Prisma.JsonValue;
  paytable: Prisma.JsonValue | null;
  serverSeedHash: string | null;
  clientSeed: string | null;
  nonce: number | null;
  payoutAtomic: bigint | null;
  createdAt: Date;
  finishedAt: Date | null;
  betReservation: { walletId: string };
};

const parseCard = (card: CardCode): { rank: CardRank; suit: CardSuit } => {
  const suit = card.slice(-1) as CardSuit;
  const rank = card.slice(0, -1) as CardRank;
  return { rank, suit };
};

const cardValueHard = (rank: CardRank): number => {
  if (rank === "A") {
    return 1;
  }
  if (["J", "Q", "K"].includes(rank)) {
    return 10;
  }
  return Number(rank);
};

const handValue = (cards: CardCode[]): number => {
  let total = cards.reduce((sum, card) => sum + cardValueHard(parseCard(card).rank), 0);
  const aces = cards.filter((card) => parseCard(card).rank === "A").length;
  let softAces = aces;
  while (softAces > 0 && total + 10 <= 21) {
    total += 10;
    softAces -= 1;
  }
  return total;
};

const isNaturalBlackjack = (cards: CardCode[]): boolean => cards.length === 2 && handValue(cards) === 21;

const isPair = (cards: CardCode[]): boolean => {
  if (cards.length !== 2) {
    return false;
  }
  return parseCard(cards[0]).rank === parseCard(cards[1]).rank;
};

const ensureBetWithinLimit = (betAtomic: bigint): void => {
  const maxAtomic = MAX_GAME_BET_ATOMIC;
  if (betAtomic > maxAtomic) {
    throw new AppError("You can't bet more than 5000 per game", 400, "BET_LIMIT_EXCEEDED");
  }
};

const shuffledDeck = (serverSeed: string, clientSeed: string, nonce: number): CardCode[] => {
  const deck: CardCode[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}` as CardCode);
    }
  }

  let round = 0;
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const rand = deterministicRandom(serverSeed, clientSeed, nonce, round);
    const j = Math.floor(rand * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
    round += 1;
  }
  return deck;
};

const drawCard = (state: StoredDeckState): CardCode => {
  const card = state.cards[state.cursor];
  if (!card) {
    throw new AppError("Deck exhausted", 500, "BLACKJACK_DECK_EXHAUSTED");
  }
  state.cursor += 1;
  return card;
};

const parseStoredState = (
  rawPlayerHands: Prisma.JsonValue,
  rawDealerCards: Prisma.JsonValue,
  rawDeck: Prisma.JsonValue
): StoredGameState => {
  const playerHands = Array.isArray(rawPlayerHands) ? (rawPlayerHands as StoredHand[]) : [];
  const dealerCards = Array.isArray(rawDealerCards) ? (rawDealerCards as CardCode[]) : [];
  const rawDeckState = (rawDeck ?? {}) as Partial<StoredDeckState>;
  const deck: StoredDeckState = {
    cards: Array.isArray(rawDeckState.cards) ? (rawDeckState.cards as CardCode[]) : [],
    cursor: typeof rawDeckState.cursor === "number" ? rawDeckState.cursor : 0
  };
  return { playerHands, dealerCards, deck };
};

const toNumericSidePayoutConfig = (
  config: Awaited<ReturnType<typeof getBlackjackPayoutConfig>>
): SidePayoutConfigNumeric => ({
  pairsMultiplier: Number(config.pairsMultiplier.toString()),
  plus3Multiplier: Number(config.plus3Multiplier.toString())
});

type ProvablyFairContext = {
  profile: {
    userId: string;
    clientSeed: string;
    nonce: number;
    activeSeedId: string;
  };
  activeSeed: {
    id: string;
    serverSeed: string;
    serverSeedHash: string;
    status: "ACTIVE" | "REVEALED";
  };
};

const RNG_BYTES = 6;
const RNG_MAX = 2 ** (RNG_BYTES * 8);

const generateServerSeed = (): string => randomBytes(32).toString("hex");

const hashServerSeed = (serverSeed: string): string =>
  createHash("sha256").update(serverSeed).digest("hex");

const generateClientSeed = (): string => randomUUID();

const deterministicRandom = (serverSeed: string, clientSeed: string, nonce: number, round: number): number => {
  const digest = createHmac("sha256", serverSeed).update(`${clientSeed}:${nonce}:${round}`).digest();
  const int = digest.readUIntBE(0, RNG_BYTES);
  return int / RNG_MAX;
};

const ensureProvablyFairContext = async (
  tx: Prisma.TransactionClient,
  userId: string
): Promise<ProvablyFairContext> => {
  const existing = await tx.provablyFairProfile.findUnique({
    where: { userId },
    include: { activeSeed: true }
  });

  if (!existing) {
    const serverSeed = generateServerSeed();
    const activeSeed = await tx.provablyFairSeed.create({
      data: {
        userId,
        serverSeed,
        serverSeedHash: hashServerSeed(serverSeed)
      }
    });

    const profile = await tx.provablyFairProfile.create({
      data: {
        userId,
        clientSeed: generateClientSeed(),
        nonce: 0,
        activeSeedId: activeSeed.id
      }
    });

    return {
      profile,
      activeSeed
    };
  }

  if (existing.activeSeed.status === "ACTIVE") {
    return {
      profile: existing,
      activeSeed: existing.activeSeed
    };
  }

  const serverSeed = generateServerSeed();
  const newSeed = await tx.provablyFairSeed.create({
    data: {
      userId,
      serverSeed,
      serverSeedHash: hashServerSeed(serverSeed)
    }
  });
  const profile = await tx.provablyFairProfile.update({
    where: { userId },
    data: {
      activeSeedId: newSeed.id,
      nonce: 0
    }
  });

  return {
    profile,
    activeSeed: newSeed
  };
};

const toWalletSnapshot = (id: string, balanceAtomic: bigint, lockedAtomic: bigint): WalletSnapshot => ({
  walletId: id,
  balanceAtomic,
  lockedAtomic
});

const getWalletSnapshotById = async (walletId: string): Promise<WalletSnapshot> => {
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { id: true, balanceAtomic: true, lockedAtomic: true }
  });
  if (!wallet) {
    throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
  }
  return toWalletSnapshot(wallet.id, wallet.balanceAtomic, wallet.lockedAtomic);
};

const toGameState = async (game: GameToStateInput): Promise<BlackjackGameState> => {
  const wallet = await getWalletSnapshotById(game.betReservation.walletId);
  const parsed = parseStoredState(game.playerHands, game.dealerCards, game.deck ?? {});

  return {
    gameId: game.id,
    status: game.status as BlackjackGameState["status"],
    currency: game.currency,
    initialBetAtomic: game.initialBetAtomic,
    mainBetAtomic: game.mainBetAtomic,
    sideBetPairsAtomic: game.sideBetPairsAtomic,
    sideBet21Plus3Atomic: game.sideBet21Plus3Atomic,
    insuranceBetAtomic: game.insuranceBetAtomic,
    canSplit: game.canSplit,
    canInsurance: game.canInsurance,
    activeHandIndex: game.activeHandIndex,
    dealerRevealed: game.dealerRevealed,
    playerHands: parsed.playerHands.map((hand) => {
      const value = handValue(hand.cards);
      return {
        cards: hand.cards,
        stakeAtomic: BigInt(hand.stakeAtomic),
        doubled: hand.doubled,
        stood: hand.stood,
        busted: hand.busted,
        blackjack: hand.blackjack,
        value
      };
    }),
    dealerCards: parsed.dealerCards,
    dealerVisibleCards: game.dealerRevealed ? parsed.dealerCards : parsed.dealerCards.slice(0, 1),
    paytable:
      game.paytable && typeof game.paytable === "object" && !Array.isArray(game.paytable)
        ? ({
            pairsMultiplier: Number((game.paytable as Record<string, unknown>).pairsMultiplier ?? 11),
            plus3Multiplier: Number((game.paytable as Record<string, unknown>).plus3Multiplier ?? 9)
          } as BlackjackGameState["paytable"])
        : {
            pairsMultiplier: 11,
            plus3Multiplier: 9
          },
    provablyFair: {
      serverSeedHash: game.serverSeedHash ?? "",
      clientSeed: game.clientSeed ?? "",
      nonce: game.nonce ?? 0
    },
    payoutAtomic: game.payoutAtomic,
    createdAt: game.createdAt,
    finishedAt: game.finishedAt,
    wallet
  };
};

const captureReservationFunds = async (
  tx: Prisma.TransactionClient,
  game: Awaited<ReturnType<typeof lockGameForUser>>,
  idempotencyKey: string,
  amountAtomicOverride?: bigint
): Promise<void> => {
  const amountAtomic = amountAtomicOverride ?? game.initialBetAtomic;
  if (game.betReservation.status === BetReservationStatus.CAPTURED) {
    return;
  }
  if (game.betReservation.status === BetReservationStatus.RELEASED) {
    throw new AppError("Bet reservation was already released", 409, "BET_RESERVATION_RELEASED");
  }

  const transition = await tx.betReservation.updateMany({
    where: {
      id: game.betReservation.id,
      status: BetReservationStatus.HELD
    },
    data: {
      status: BetReservationStatus.CAPTURED,
      captureIdempotencyKey: idempotencyKey,
      capturedAt: new Date()
    }
  });
  if (transition.count === 0) {
    throw new AppError("Bet reservation state conflict", 409, "BET_RESERVATION_STATE_CONFLICT");
  }

  const walletRows = await tx.$queryRaw<Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>>`
    UPDATE "wallets"
    SET "lockedAtomic" = "lockedAtomic" - ${amountAtomic},
        "updatedAt" = NOW()
    WHERE "id" = ${game.betReservation.walletId}
      AND "lockedAtomic" >= ${amountAtomic}
    RETURNING id, "balanceAtomic", "lockedAtomic"
  `;
  if (!walletRows[0]) {
    throw new AppError("Wallet lock invariant violated", 409, "WALLET_LOCK_INVARIANT_VIOLATED");
  }

  await tx.ledgerEntry.create({
    data: {
      walletId: game.betReservation.walletId,
      direction: LedgerDirection.DEBIT,
      reason: LedgerReason.BET_CAPTURE,
      amountAtomic,
      balanceBeforeAtomic: walletRows[0].balanceAtomic,
      balanceAfterAtomic: walletRows[0].balanceAtomic,
      idempotencyKey,
      referenceId: game.betReference,
      metadata: {
        game: "BLACKJACK",
        operation: "CAPTURE"
      } as Prisma.InputJsonValue
    }
  });
};

const evaluate21Plus3 = (playerCards: CardCode[], dealerUpCard: CardCode): boolean => {
  const cards = [playerCards[0], playerCards[1], dealerUpCard];
  const ranks = cards.map((card) => parseCard(card).rank);
  const suits = cards.map((card) => parseCard(card).suit);
  const values = ranks.map((rank) => (rank === "A" ? 1 : rank === "J" || rank === "Q" || rank === "K" ? 10 : Number(rank))).sort(
    (a, b) => a - b
  );
  const flush = suits.every((suit) => suit === suits[0]);
  const trips = ranks[0] === ranks[1] && ranks[1] === ranks[2];
  const straight =
    (values[0] + 1 === values[1] && values[1] + 1 === values[2]) ||
    (values[0] === 1 && values[1] === 10 && values[2] === 11);
  return flush || trips || straight;
};

const settleDealer = (dealerCards: CardCode[], deck: StoredDeckState): CardCode[] => {
  const cards = [...dealerCards];
  while (true) {
    const value = handValue(cards);
    if (value >= 17) {
      break;
    }
    cards.push(drawCard(deck));
  }
  return cards;
};

const payoutForMainHand = (hand: StoredHand, dealerValue: number, dealerBlackjack: boolean): bigint => {
  const stake = BigInt(hand.stakeAtomic);
  const value = handValue(hand.cards);
  if (hand.busted || value > 21) {
    return 0n;
  }

  if (hand.blackjack && !dealerBlackjack) {
    return (stake * 25n) / 10n;
  }
  if (dealerValue > 21) {
    return stake * STANDARD_PAYOUT;
  }
  if (dealerBlackjack && !hand.blackjack) {
    return 0n;
  }
  if (value > dealerValue) {
    return stake * STANDARD_PAYOUT;
  }
  if (value === dealerValue) {
    return stake;
  }
  return 0n;
};

const resolveCurrentGame = (
  state: StoredGameState,
  insuranceBetAtomic: bigint | null,
  sideBetPairsAtomic: bigint,
  sideBet21Plus3Atomic: bigint,
  sidePayoutConfig: SidePayoutConfigNumeric
) => {
  const dealerCards = settleDealer(state.dealerCards, state.deck);
  const dealerValue = handValue(dealerCards);
  const dealerBlackjack = isNaturalBlackjack(dealerCards);

  let mainPayout = 0n;
  for (const hand of state.playerHands) {
    mainPayout += payoutForMainHand(hand, dealerValue, dealerBlackjack);
  }

  let insurancePayout = 0n;
  if (insuranceBetAtomic && insuranceBetAtomic > 0n && dealerBlackjack) {
    insurancePayout = insuranceBetAtomic * INSURANCE_PAYOUT;
  }

  let sidePayout = 0n;
  const firstHand = state.playerHands[0];
  if (sideBetPairsAtomic > 0n && firstHand && isPair(firstHand.cards)) {
    sidePayout += sideBetPairsAtomic * BigInt(sidePayoutConfig.pairsMultiplier);
  }
  if (sideBet21Plus3Atomic > 0n && firstHand && evaluate21Plus3(firstHand.cards, dealerCards[0])) {
    sidePayout += sideBet21Plus3Atomic * BigInt(sidePayoutConfig.plus3Multiplier);
  }

  const payoutAtomic = mainPayout + insurancePayout + sidePayout;
  return {
    dealerCards,
    dealerValue,
    dealerBlackjack,
    mainPayout,
    insurancePayout,
    sidePayout,
    payoutAtomic
  };
};

const lockGameForUser = async (tx: Prisma.TransactionClient, gameId: string, userId: string) => {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "blackjack_games"
    WHERE id = ${gameId}
      AND "userId" = ${userId}
    FOR UPDATE
  `;
  if (!rows[0]) {
    throw new AppError("Blackjack game not found", 404, "BLACKJACK_GAME_NOT_FOUND");
  }

  const game = await tx.blackjackGame.findUnique({
    where: { id: gameId },
    include: {
      betReservation: {
        select: {
          id: true,
          walletId: true,
          status: true
        }
      }
    }
  });

  if (!game || !game.betReservation) {
    throw new AppError("Blackjack game integrity error", 500, "BLACKJACK_GAME_INTEGRITY_ERROR");
  }
  return game;
};

const creditWalletPayout = async (
  tx: Prisma.TransactionClient,
  walletId: string,
  payoutAtomic: bigint,
  idempotencyKey: string,
  referenceId: string
): Promise<WalletSnapshot> => {
  const walletRows = await tx.$queryRaw<Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>>`
    UPDATE "wallets"
    SET "balanceAtomic" = "balanceAtomic" + ${payoutAtomic},
        "updatedAt" = NOW()
    WHERE "id" = ${walletId}
    RETURNING id, "balanceAtomic", "lockedAtomic"
  `;
  const wallet = walletRows[0];
  if (!wallet) {
    throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
  }

  if (payoutAtomic > 0n) {
    const balanceBefore = wallet.balanceAtomic - payoutAtomic;
    await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        direction: LedgerDirection.CREDIT,
        reason: LedgerReason.BET_PAYOUT,
        amountAtomic: payoutAtomic,
        balanceBeforeAtomic: balanceBefore,
        balanceAfterAtomic: wallet.balanceAtomic,
        idempotencyKey,
        referenceId,
        metadata: {
          game: "BLACKJACK",
          operation: "PAYOUT"
        } as Prisma.InputJsonValue
      }
    });
  }
  return toWalletSnapshot(wallet.id, wallet.balanceAtomic, wallet.lockedAtomic);
};

const finalizeGameInTx = async (
  tx: Prisma.TransactionClient,
  game: Awaited<ReturnType<typeof lockGameForUser>>,
  effectiveInitialBetAtomic?: bigint
) => {
  const sidePayoutConfig = toNumericSidePayoutConfig(await getBlackjackPayoutConfig());
  const state = parseStoredState(game.playerHands, game.dealerCards, game.deck);
  const resolved = resolveCurrentGame(
    state,
    game.insuranceBetAtomic ?? null,
    game.sideBetPairsAtomic,
    game.sideBet21Plus3Atomic,
    sidePayoutConfig
  );

  const walletSnapshot = await creditWalletPayout(
    tx,
    game.betReservation.walletId,
    resolved.payoutAtomic,
    `blackjack:${game.id}:payout`,
    game.betReference
  );

  const updated = await tx.blackjackGame.update({
    where: { id: game.id },
    data: {
      playerHands: game.playerHands as Prisma.InputJsonValue,
      deck: game.deck as Prisma.InputJsonValue,
      status:
        resolved.payoutAtomic > (effectiveInitialBetAtomic ?? game.initialBetAtomic)
          ? "WON"
          : resolved.payoutAtomic === (effectiveInitialBetAtomic ?? game.initialBetAtomic)
            ? "PUSH"
            : "LOST",
      dealerCards: resolved.dealerCards as unknown as Prisma.InputJsonValue,
      dealerRevealed: true,
      mainPayoutAtomic: resolved.mainPayout,
      sidePayoutAtomic: resolved.sidePayout,
      insurancePayoutAtomic: resolved.insurancePayout,
      payoutAtomic: resolved.payoutAtomic,
      finishedAt: new Date()
    },
    include: {
      betReservation: {
        select: {
          walletId: true
        }
      }
    }
  });

  return {
    state: await toGameState(updated),
    walletSnapshot
  };
};

export const startBlackjackGame = async (input: StartBlackjackInput): Promise<StartResult> => {
  if (input.currency !== PLATFORM_INTERNAL_CURRENCY) {
    throw new AppError(`Only ${PLATFORM_INTERNAL_CURRENCY} is supported as internal virtual currency`, 400, "UNSUPPORTED_CURRENCY");
  }
  if (input.betAtomic <= 0n) {
    throw new AppError("betAtomic must be greater than 0", 400, "INVALID_BET");
  }
  ensureBetWithinLimit(input.betAtomic);

  const pairsBet = input.sideBetPairsAtomic ?? 0n;
  const plus3Bet = input.sideBet21Plus3Atomic ?? 0n;
  if (pairsBet < 0n || plus3Bet < 0n) {
    throw new AppError("side bets cannot be negative", 400, "INVALID_SIDE_BET");
  }
  ensureBetWithinLimit(pairsBet);
  ensureBetWithinLimit(plus3Bet);

  const totalInitial = input.betAtomic + pairsBet + plus3Bet;
  ensureBetWithinLimit(totalInitial);

  const result = await prisma.$transaction(async (tx) => {
    await ensureProvablyFairContext(tx, input.userId);
    const nonceRows = await tx.$queryRaw<Array<{ nonce: number; activeSeedId: string; clientSeed: string }>>`
      UPDATE "provably_fair_profiles"
      SET nonce = nonce + 1,
          "updatedAt" = NOW()
      WHERE "userId" = ${input.userId}
      RETURNING nonce - 1 AS nonce, "activeSeedId", "clientSeed"
    `;
    const nonceState = nonceRows[0];
    if (!nonceState) {
      throw new AppError("Unable to allocate provably fair nonce", 500, "BLACKJACK_NONCE_ALLOCATION_FAILED");
    }

    const seed = await tx.provablyFairSeed.findUnique({
      where: { id: nonceState.activeSeedId }
    });
    if (!seed || seed.status !== "ACTIVE") {
      throw new AppError("Active server seed not found", 500, "ACTIVE_SERVER_SEED_NOT_FOUND");
    }

    const wallet = await debitBalanceInTx(tx, {
      userId: input.userId,
      currency: input.currency,
      amountAtomic: totalInitial,
      lockAmountAtomic: totalInitial
    });
    // XP is best-effort and must never abort the blackjack wager transaction.
    void addUserXpBestEffort(input.userId, totalInitial);

    const betReference = `blackjack:${randomUUID()}`;
    const holdEntry = await tx.ledgerEntry.create({
      data: {
        walletId: wallet.walletId,
        direction: LedgerDirection.DEBIT,
        reason: LedgerReason.BET_HOLD,
        amountAtomic: totalInitial,
        balanceBeforeAtomic: wallet.balanceBeforeAtomic,
        balanceAfterAtomic: wallet.balanceAtomic,
        idempotencyKey: input.idempotencyKey,
        referenceId: betReference,
        metadata: {
          game: "BLACKJACK",
          operation: "HOLD"
        } as Prisma.InputJsonValue
      }
    });

    const reservation = await tx.betReservation.create({
      data: {
        userId: input.userId,
        walletId: wallet.walletId,
        currency: input.currency,
        betReference,
        amountAtomic: totalInitial,
        status: BetReservationStatus.HELD,
        holdIdempotencyKey: input.idempotencyKey,
        holdTransactionId: holdEntry.id,
        metadata: {
          game: "BLACKJACK"
        } as Prisma.InputJsonValue
      }
    });

  const sidePayoutConfigRaw = await getBlackjackPayoutConfig();
  const sidePayoutConfig = {
    pairsMultiplier: Number(sidePayoutConfigRaw.pairsMultiplier.toString()),
    plus3Multiplier: Number(sidePayoutConfigRaw.plus3Multiplier.toString())
  };
    const deckState: StoredDeckState = {
      cards: shuffledDeck(seed.serverSeed, nonceState.clientSeed, nonceState.nonce),
      cursor: 0
    };
    const playerCards: CardCode[] = [drawCard(deckState), drawCard(deckState)];
    const dealerCards: CardCode[] = [drawCard(deckState), drawCard(deckState)];

    const initialHand: StoredHand = {
      cards: playerCards,
      stakeAtomic: input.betAtomic.toString(),
      doubled: false,
      stood: false,
      busted: false,
      blackjack: isNaturalBlackjack(playerCards)
    };

    const canSplit = isPair(playerCards);
    const canInsurance = parseCard(dealerCards[0]).rank === "A";
    const game = await tx.blackjackGame.create({
      data: {
        userId: input.userId,
        currency: input.currency,
        initialBetAtomic: totalInitial,
        mainBetAtomic: input.betAtomic,
        sideBetPairsAtomic: pairsBet,
        sideBet21Plus3Atomic: plus3Bet,
        status: "ACTIVE",
        betReference,
        betReservationId: reservation.id,
        serverSeedId: seed.id,
        serverSeedHash: seed.serverSeedHash,
        clientSeed: nonceState.clientSeed,
        nonce: nonceState.nonce,
        paytable: {
          pairsMultiplier: Number(sidePayoutConfig.pairsMultiplier.toString()),
          plus3Multiplier: Number(sidePayoutConfig.plus3Multiplier.toString())
        } as Prisma.InputJsonValue,
        playerHands: [initialHand] as unknown as Prisma.InputJsonValue,
        dealerCards: dealerCards as unknown as Prisma.InputJsonValue,
        deck: deckState as unknown as Prisma.InputJsonValue,
        activeHandIndex: 0,
        dealerRevealed: false,
        canSplit,
        canInsurance
      },
      include: {
        betReservation: {
          select: { walletId: true }
        }
      }
    });

    let updatedGame = game;
    if (initialHand.blackjack) {
      const finalized = await finalizeGameInTx(tx, game as Awaited<ReturnType<typeof lockGameForUser>>);
      updatedGame = await tx.blackjackGame.findUniqueOrThrow({
        where: { id: finalized.state.gameId },
        include: { betReservation: { select: { walletId: true } } }
      });
    }

    return {
      state: await toGameState(updatedGame)
    };
  });

  void enqueueAuditEvent({
    type: "BLACKJACK_GAME_STARTED",
    actorId: input.userId,
    targetId: input.userId,
    metadata: {
      gameId: result.state.gameId,
      initialBetAtomic: result.state.initialBetAtomic.toString()
    }
  });

  return result;
};

const findActiveGameByIdempotency = async (userId: string, idempotencyKey: string): Promise<BlackjackGameState | null> => {
  const existing = await prisma.blackjackGame.findFirst({
    where: {
      userId,
      betReservation: {
        is: {
          holdIdempotencyKey: idempotencyKey
        }
      }
    },
    orderBy: { createdAt: "desc" },
    include: {
      betReservation: { select: { walletId: true } }
    }
  });
  if (!existing) {
    return null;
  }
  return toGameState(existing);
};

export const getActiveBlackjackGame = async (userId: string): Promise<BlackjackGameState | null> => {
  const game = await prisma.blackjackGame.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      finishedAt: null
    },
    orderBy: {
      createdAt: "desc"
    },
    include: {
      betReservation: {
        select: { walletId: true }
      }
    }
  });
  if (!game) {
    return null;
  }
  return toGameState(game);
};

export const getBlackjackGameById = async (userId: string, gameId: string): Promise<BlackjackGameState> => {
  const game = await prisma.blackjackGame.findFirst({
    where: {
      id: gameId,
      userId
    },
    include: {
      betReservation: {
        select: { walletId: true }
      }
    }
  });
  if (!game) {
    throw new AppError("Blackjack game not found", 404, "BLACKJACK_GAME_NOT_FOUND");
  }
  return toGameState(game);
};

export const getOrCreateActiveBlackjackGame = async (
  input: StartBlackjackInput
): Promise<StartResult> => {
  if (input.currency !== PLATFORM_INTERNAL_CURRENCY) {
    throw new AppError(`Only ${PLATFORM_INTERNAL_CURRENCY} is supported as internal virtual currency`, 400, "UNSUPPORTED_CURRENCY");
  }
  if (input.betAtomic <= 0n) {
    throw new AppError("betAtomic must be greater than 0", 400, "INVALID_BET");
  }
  ensureBetWithinLimit(input.betAtomic);

  const pairsBet = input.sideBetPairsAtomic ?? 0n;
  const plus3Bet = input.sideBet21Plus3Atomic ?? 0n;
  if (pairsBet < 0n || plus3Bet < 0n) {
    throw new AppError("side bets cannot be negative", 400, "INVALID_SIDE_BET");
  }
  ensureBetWithinLimit(pairsBet);
  ensureBetWithinLimit(plus3Bet);

  const totalInitial = input.betAtomic + pairsBet + plus3Bet;
  ensureBetWithinLimit(totalInitial);

  const active = await getActiveBlackjackGame(input.userId);
  if (active) {
    return { state: active };
  }
  const replay = await findActiveGameByIdempotency(input.userId, input.idempotencyKey);
  if (replay) {
    return { state: replay };
  }
  return startBlackjackGame(input);
};

const findNextUnresolvedHand = (state: StoredGameState, startIndex: number): number => {
  let idx = startIndex;
  while (idx < state.playerHands.length) {
    const hand = state.playerHands[idx];
    if (!hand.stood && !hand.busted && hand.cards.length > 0) {
      return idx;
    }
    idx += 1;
  }
  return -1;
};

export const actOnBlackjackGame = async (input: PlayerActionInput): Promise<BlackjackGameState> => {
  const result = await prisma.$transaction(async (tx) => {
    const game = await lockGameForUser(tx, input.gameId, input.userId);
    if (game.status !== "ACTIVE") {
      return toGameState(game);
    }

    const state = parseStoredState(game.playerHands, game.dealerCards, game.deck);
    const hand = state.playerHands[game.activeHandIndex];
    if (!hand) {
      throw new AppError("No active hand found", 409, "BLACKJACK_ACTIVE_HAND_MISSING");
    }

    if (input.action === "INSURANCE") {
      if (!game.canInsurance || game.insuranceBetAtomic) {
        throw new AppError("Insurance is not available", 409, "BLACKJACK_INSURANCE_NOT_AVAILABLE");
      }
      const insuranceStake = game.mainBetAtomic / 2n;
      ensureBetWithinLimit(insuranceStake);
      const walletRows = await tx.$queryRaw<Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>>`
        UPDATE "wallets"
        SET "lockedAtomic" = "lockedAtomic" + ${insuranceStake},
            "balanceAtomic" = "balanceAtomic" - ${insuranceStake},
            "updatedAt" = NOW()
        WHERE "id" = ${game.betReservation.walletId}
          AND "balanceAtomic" >= ${insuranceStake}
        RETURNING id, "balanceAtomic", "lockedAtomic"
      `;
      if (!walletRows[0]) {
        throw new AppError("Insufficient funds for insurance", 422, "INSUFFICIENT_FUNDS");
      }
      await tx.blackjackGame.update({
        where: { id: game.id },
        data: {
          insuranceBetAtomic: insuranceStake,
          initialBetAtomic: {
            increment: insuranceStake
          }
        }
      });
      await tx.betReservation.update({
        where: { id: game.betReservation.id },
        data: {
          amountAtomic: {
            increment: insuranceStake
          }
        }
      });
      await tx.ledgerEntry.create({
        data: {
          walletId: game.betReservation.walletId,
          direction: LedgerDirection.DEBIT,
          reason: LedgerReason.BET_HOLD,
          amountAtomic: insuranceStake,
          balanceBeforeAtomic: walletRows[0].balanceAtomic + insuranceStake,
          balanceAfterAtomic: walletRows[0].balanceAtomic,
          idempotencyKey: input.idempotencyKey ?? `blackjack:${game.id}:insurance`,
          referenceId: game.betReference,
          metadata: {
            game: "BLACKJACK",
            operation: "INSURANCE_HOLD"
          } as Prisma.InputJsonValue
        }
      });
      const refreshed = await tx.blackjackGame.findUniqueOrThrow({
        where: { id: game.id },
        include: { betReservation: { select: { walletId: true } } }
      });
      return toGameState(refreshed);
    }

    if (hand.stood || hand.busted) {
      throw new AppError("Current hand is already resolved", 409, "BLACKJACK_HAND_RESOLVED");
    }

    if (input.action === "HIT") {
      if (hand.doubled) {
        throw new AppError("Cannot hit after double", 409, "BLACKJACK_HIT_AFTER_DOUBLE_FORBIDDEN");
      }
      hand.cards.push(drawCard(state.deck));
      const value = handValue(hand.cards);
      if (value > 21) {
        hand.busted = true;
        hand.stood = true;
      }
    } else if (input.action === "DOUBLE") {
      if (hand.cards.length !== 2 || hand.doubled) {
        throw new AppError("Double is not allowed now", 409, "BLACKJACK_DOUBLE_NOT_ALLOWED");
      }
      const extraStake = BigInt(hand.stakeAtomic);
      ensureBetWithinLimit(extraStake);
      const walletRows = await tx.$queryRaw<Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>>`
        UPDATE "wallets"
        SET "lockedAtomic" = "lockedAtomic" + ${extraStake},
            "balanceAtomic" = "balanceAtomic" - ${extraStake},
            "updatedAt" = NOW()
        WHERE "id" = ${game.betReservation.walletId}
          AND "balanceAtomic" >= ${extraStake}
        RETURNING id, "balanceAtomic", "lockedAtomic"
      `;
      if (!walletRows[0]) {
        throw new AppError("Insufficient funds to double", 422, "INSUFFICIENT_FUNDS");
      }
      await tx.blackjackGame.update({
        where: { id: game.id },
        data: {
          mainBetAtomic: {
            increment: extraStake
          },
          initialBetAtomic: {
            increment: extraStake
          }
        }
      });
      await tx.betReservation.update({
        where: { id: game.betReservation.id },
        data: {
          amountAtomic: {
            increment: extraStake
          }
        }
      });
      hand.stakeAtomic = (BigInt(hand.stakeAtomic) + extraStake).toString();
      hand.doubled = true;
      hand.cards.push(drawCard(state.deck));
      const value = handValue(hand.cards);
      if (value > 21) {
        hand.busted = true;
      }
      hand.stood = true;
    } else if (input.action === "SPLIT") {
      if (!game.canSplit || state.playerHands.length !== 1 || !isPair(hand.cards)) {
        throw new AppError("Split is not available", 409, "BLACKJACK_SPLIT_NOT_AVAILABLE");
      }
      const extraStake = BigInt(hand.stakeAtomic);
      ensureBetWithinLimit(extraStake);
      const walletRows = await tx.$queryRaw<Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>>`
        UPDATE "wallets"
        SET "lockedAtomic" = "lockedAtomic" + ${extraStake},
            "balanceAtomic" = "balanceAtomic" - ${extraStake},
            "updatedAt" = NOW()
        WHERE "id" = ${game.betReservation.walletId}
          AND "balanceAtomic" >= ${extraStake}
        RETURNING id, "balanceAtomic", "lockedAtomic"
      `;
      if (!walletRows[0]) {
        throw new AppError("Insufficient funds to split", 422, "INSUFFICIENT_FUNDS");
      }
      await tx.blackjackGame.update({
        where: { id: game.id },
        data: {
          mainBetAtomic: {
            increment: extraStake
          },
          initialBetAtomic: {
            increment: extraStake
          },
          canSplit: false
        }
      });
      await tx.betReservation.update({
        where: { id: game.betReservation.id },
        data: {
          amountAtomic: {
            increment: extraStake
          }
        }
      });

      const first = hand.cards[0];
      const second = hand.cards[1];
      state.playerHands = [
        {
          cards: [first, drawCard(state.deck)],
          stakeAtomic: hand.stakeAtomic,
          doubled: false,
          stood: false,
          busted: false,
          blackjack: false
        },
        {
          cards: [second, drawCard(state.deck)],
          stakeAtomic: hand.stakeAtomic,
          doubled: false,
          stood: false,
          busted: false,
          blackjack: false
        }
      ];
    } else if (input.action === "STAND") {
      hand.stood = true;
    } else {
      throw new AppError("Unsupported blackjack action", 400, "BLACKJACK_ACTION_INVALID");
    }

    const currentIndex = game.activeHandIndex;
    const currentHandAfterAction = state.playerHands[currentIndex];
    const currentHandResolved = Boolean(currentHandAfterAction?.stood || currentHandAfterAction?.busted);

    if (!currentHandResolved) {
      const updated = await tx.blackjackGame.update({
        where: { id: game.id },
        data: {
          playerHands: state.playerHands as unknown as Prisma.InputJsonValue,
          deck: state.deck as unknown as Prisma.InputJsonValue,
          activeHandIndex: currentIndex
        },
        include: { betReservation: { select: { walletId: true } } }
      });
      return toGameState(updated);
    }

    const nextIndex = findNextUnresolvedHand(state, currentIndex + 1);
    if (nextIndex >= 0) {
      const updated = await tx.blackjackGame.update({
        where: { id: game.id },
        data: {
          playerHands: state.playerHands as unknown as Prisma.InputJsonValue,
          deck: state.deck as unknown as Prisma.InputJsonValue,
          activeHandIndex: nextIndex
        },
        include: { betReservation: { select: { walletId: true } } }
      });
      return toGameState(updated);
    }

    const gameForCapture = await tx.blackjackGame.findUniqueOrThrow({
      where: { id: game.id },
      include: {
        betReservation: {
          select: {
            id: true,
            walletId: true,
            status: true,
            amountAtomic: true
          }
        }
      }
    });

    await captureReservationFunds(
      tx,
      gameForCapture as Awaited<ReturnType<typeof lockGameForUser>>,
      `blackjack:${game.id}:capture`,
      gameForCapture.betReservation.amountAtomic
    );
    const finalized = await finalizeGameInTx(tx, {
      ...gameForCapture,
      playerHands: state.playerHands as unknown as Prisma.JsonValue,
      deck: state.deck as unknown as Prisma.JsonValue
    } as Awaited<ReturnType<typeof lockGameForUser>>, gameForCapture.betReservation.amountAtomic);
    return finalized.state;
  });

  return result;
};
