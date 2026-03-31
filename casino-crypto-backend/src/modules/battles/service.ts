import {
  BattleSlotState,
  BattleStatus,
  BattleTemplate,
  Prisma
} from "@prisma/client";
import { randomUUID } from "node:crypto";

import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";
import { addAffiliateCommissionBestEffort } from "../affiliates/service";
import { addUserXpBestEffort } from "../progression/service";
import { captureHeldFunds, holdFundsForBet, releaseHeldFunds } from "../wallets/bet-reservation.service";
import { MAX_GAME_BET_ATOMIC, PLATFORM_INTERNAL_CURRENCY } from "../wallets/service";

const BATTLE_BOT_POOL_SIZE = 100;
const BATTLE_MIN_BORROW_PERCENT = 20;
const BATTLE_MAX_BORROW_PERCENT = 100;
const BATTLE_MAX_CASES = 50;
const BATTLE_AFFILIATE_SOURCE = "BATTLES";

const isMissingBattlesSchemaError = (error: unknown): boolean => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (error.code !== "P2021" && error.code !== "P2022") {
    return false;
  }
  const target = String((error.meta as { table?: unknown; column?: unknown; target?: unknown } | undefined)?.target ?? "");
  const table = String((error.meta as { table?: unknown } | undefined)?.table ?? "");
  const column = String((error.meta as { column?: unknown } | undefined)?.column ?? "");
  const payload = `${target} ${table} ${column}`.toLowerCase();
  if (!payload) {
    return true;
  }
  return payload.includes("battle");
};

const battlesNotReadyError = () =>
  new AppError(
    "Battles mode is initializing. Please run migrations/deploy and try again in a moment.",
    503,
    "BATTLES_NOT_READY"
  );

const ensureBattlesSchemaReady = async (): Promise<void> => {
  try {
    // Validate that core tables and columns required by create/join exist before charging users.
    await prisma.$queryRaw<Array<{ id: string; modeBorrow: boolean }>>`
      SELECT "id", "modeBorrow" FROM "battles" LIMIT 1
    `;
    await prisma.$queryRaw<Array<{ id: string; borrowPercent: number; paidAmountAtomic: bigint }>>`
      SELECT "id", "borrowPercent", "paidAmountAtomic" FROM "battle_slots" LIMIT 1
    `;
  } catch (error) {
    if (isMissingBattlesSchemaError(error)) {
      throw battlesNotReadyError();
    }
    throw error;
  }
};

type TemplateDefinition = {
  seats: number;
  teams: number;
  seatsPerTeam: number;
};

const TEMPLATE_DEFINITIONS: Record<BattleTemplate, TemplateDefinition> = {
  ONE_VS_ONE: { seats: 2, teams: 2, seatsPerTeam: 1 },
  TWO_VS_TWO: { seats: 4, teams: 2, seatsPerTeam: 2 },
  ONE_VS_ONE_VS_ONE: { seats: 3, teams: 3, seatsPerTeam: 1 },
  ONE_VS_ONE_VS_ONE_VS_ONE: { seats: 4, teams: 4, seatsPerTeam: 1 },
  ONE_VS_ONE_VS_ONE_VS_ONE_VS_ONE_VS_ONE: { seats: 6, teams: 6, seatsPerTeam: 1 },
  TWO_VS_TWO_VS_TWO: { seats: 6, teams: 3, seatsPerTeam: 2 },
  THREE_VS_THREE: { seats: 6, teams: 2, seatsPerTeam: 3 }
};

const GROUP_ALLOWED: Set<BattleTemplate> = new Set([
  BattleTemplate.ONE_VS_ONE,
  BattleTemplate.ONE_VS_ONE_VS_ONE,
  BattleTemplate.ONE_VS_ONE_VS_ONE_VS_ONE,
  BattleTemplate.ONE_VS_ONE_VS_ONE_VS_ONE_VS_ONE_VS_ONE
]);

const TEAM_SHARE_NUMERATOR: Record<BattleTemplate, bigint> = {
  ONE_VS_ONE: 100n,
  TWO_VS_TWO: 50n,
  ONE_VS_ONE_VS_ONE: 100n,
  ONE_VS_ONE_VS_ONE_VS_ONE: 100n,
  ONE_VS_ONE_VS_ONE_VS_ONE_VS_ONE_VS_ONE: 100n,
  TWO_VS_TWO_VS_TWO: 50n,
  THREE_VS_THREE: 33n
};

export type BattleCreateInput = {
  userId: string;
  template: BattleTemplate;
  modeCrazy?: boolean;
  modeGroup?: boolean;
  modeJackpot?: boolean;
  modeTerminal?: boolean;
  modePrivate?: boolean;
  modeBorrow?: boolean;
  cases: string[];
  creatorBorrowPercent?: number;
};

type BattleSlotView = {
  id: string;
  seatIndex: number;
  teamIndex: number;
  state: BattleSlotState;
  userId: string | null;
  displayName: string;
  isBot: boolean;
  borrowPercent: number;
  paidAmountAtomic: bigint;
  payoutAtomic: bigint;
  winWeightAtomic: bigint;
  profitAtomic: bigint;
};

type BattleCaseView = {
  id: string;
  caseId: string;
  orderIndex: number;
  priceAtomic: bigint;
  case: {
    id: string;
    slug: string;
    title: string;
    logoUrl: string | null;
  };
};

type BattleDropView = {
  id: string;
  battleCaseId: string;
  battleSlotId: string;
  roundIndex: number;
  orderIndex: number;
  valueAtomic: bigint;
  caseItem: {
    id: string;
    name: string;
    imageUrl: string | null;
    valueAtomic: bigint;
  };
};

type BattleState = {
  id: string;
  status: BattleStatus;
  template: BattleTemplate;
  modeCrazy: boolean;
  modeGroup: boolean;
  modeJackpot: boolean;
  modeTerminal: boolean;
  modePrivate: boolean;
  modeBorrow: boolean;
  maxCases: number;
  totalCostAtomic: bigint;
  totalPayoutAtomic: bigint;
  winnerTeam: number | null;
  winnerUserId: string | null;
  jackpotWinnerSlotId: string | null;
  jackpotSeed: string | null;
  jackpotRoll: number | null;
  createdByUserId: string;
  createdAt: Date;
  startedAt: Date | null;
  settledAt: Date | null;
  updatedAt: Date;
  cases: BattleCaseView[];
  slots: BattleSlotView[];
  drops: BattleDropView[];
};

export type BattleDetails = BattleState;

const battleTemplateSeats = (template: BattleTemplate): TemplateDefinition => {
  const value = TEMPLATE_DEFINITIONS[template];
  if (!value) {
    throw new AppError("Unsupported battle template", 400, "BATTLE_TEMPLATE_UNSUPPORTED");
  }
  return value;
};

const normalizeBorrowPercent = (input: number | undefined, modeBorrow: boolean): number => {
  if (!modeBorrow) {
    return 100;
  }
  const value = Math.trunc(input ?? 100);
  if (value < BATTLE_MIN_BORROW_PERCENT || value > BATTLE_MAX_BORROW_PERCENT) {
    throw new AppError(
      `Borrow percent must be between ${BATTLE_MIN_BORROW_PERCENT} and ${BATTLE_MAX_BORROW_PERCENT}`,
      400,
      "BATTLE_BORROW_PERCENT_INVALID"
    );
  }
  return value;
};

const validateModes = (template: BattleTemplate, input: BattleCreateInput): void => {
  const modeGroup = Boolean(input.modeGroup);
  const modeJackpot = Boolean(input.modeJackpot);
  if (modeGroup && !GROUP_ALLOWED.has(template)) {
    throw new AppError(
      "Group mode only supports 1v1, 1v1v1, 1v1v1v1 and 1v1v1v1v1v1",
      400,
      "BATTLE_GROUP_MODE_TEMPLATE_INVALID"
    );
  }
  if (modeGroup && modeJackpot) {
    throw new AppError("Jackpot mode cannot be combined with Group mode", 400, "BATTLE_MODE_CONFLICT");
  }
};

const computeSeatTeam = (template: BattleTemplate, seatIndex: number): number => {
  const def = battleTemplateSeats(template);
  if (def.seatsPerTeam <= 1) {
    return seatIndex;
  }
  return Math.floor(seatIndex / def.seatsPerTeam);
};

const getBattleForAction = async (battleId: string): Promise<{
  id: string;
  status: BattleStatus;
  template: BattleTemplate;
  modeCrazy: boolean;
  modeGroup: boolean;
  modeJackpot: boolean;
  modeTerminal: boolean;
  modePrivate: boolean;
  modeBorrow: boolean;
  totalCostAtomic: bigint;
  createdByUserId: string;
  cases: Array<{
    id: string;
    orderIndex: number;
    priceAtomic: bigint;
    caseId: string;
  }>;
  slots: Array<{
    id: string;
    seatIndex: number;
    teamIndex: number;
    state: BattleSlotState;
    userId: string | null;
    displayName: string;
    isBot: boolean;
    borrowPercent: number;
    paidAmountAtomic: bigint;
  }>;
}> => {
  const battle = await prisma.battle.findUnique({
    where: { id: battleId },
    include: {
      cases: {
        orderBy: [{ orderIndex: "asc" }]
      },
      slots: {
        orderBy: [{ seatIndex: "asc" }]
      }
    }
  });
  if (!battle) {
    throw new AppError("Battle not found", 404, "BATTLE_NOT_FOUND");
  }
  return battle;
};

const randomBotName = (): string => `Bot #${Math.floor(Math.random() * BATTLE_BOT_POOL_SIZE) + 1}`;

const scaleByBorrow = (baseAtomic: bigint, borrowPercent: number): bigint =>
  (baseAtomic * BigInt(borrowPercent)) / 100n;

const jackpotWeightFromValue = (valueAtomic: bigint): bigint => (valueAtomic > 0n ? valueAtomic : 1n);

const selectByWeight = <T>(rows: T[], weight: (item: T) => bigint, rollUnit: number): T => {
  const total = rows.reduce((acc, row) => acc + weight(row), 0n);
  if (total <= 0n) {
    return rows[0];
  }
  const max = Number(total);
  let target = BigInt(Math.max(0, Math.min(max - 1, Math.floor(rollUnit * max))));
  for (const row of rows) {
    const w = weight(row);
    if (target < w) {
      return row;
    }
    target -= w;
  }
  return rows[rows.length - 1];
};

const battleSeedRandom = (seed: string, step: number): number => {
  const basis = `${seed}:${step}`;
  let hash = 2166136261;
  for (let idx = 0; idx < basis.length; idx += 1) {
    hash ^= basis.charCodeAt(idx);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1_000_000) / 1_000_000;
};

const pickCaseItemForRound = async (
  tx: Prisma.TransactionClient,
  caseId: string,
  seed: string,
  nonce: number
): Promise<{
  id: string;
  name: string;
  imageUrl: string | null;
  valueAtomic: bigint;
}> => {
  const items = await tx.caseItem.findMany({
    where: {
      caseId,
      isActive: true
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
  if (!items.length) {
    throw new AppError("Case has no active items", 409, "CASE_WITHOUT_ITEMS");
  }
  const weighted = items.map((item, idx) => ({
    item,
    idx,
    weight: Number(item.dropRate.toString())
  }));
  let cumulative = 0;
  const roll = battleSeedRandom(seed, nonce) * 100;
  for (const row of weighted) {
    cumulative += row.weight;
    if (roll <= cumulative + 0.0000001) {
      return {
        id: row.item.id,
        name: row.item.name,
        imageUrl: row.item.imageUrl,
        valueAtomic: row.item.valueAtomic
      };
    }
  }
  const fallback = items[items.length - 1];
  return {
    id: fallback.id,
    name: fallback.name,
    imageUrl: fallback.imageUrl,
    valueAtomic: fallback.valueAtomic
  };
};

const getSlotOutcomeScore = (input: {
  modeTerminal: boolean;
  modeCrazy: boolean;
  dropsBySlot: Map<string, Array<{ roundIndex: number; valueAtomic: bigint }>>;
  slotId: string;
}): bigint => {
  const drops = input.dropsBySlot.get(input.slotId) ?? [];
  const source = input.modeTerminal ? drops.slice(-1) : drops;
  const total = source.reduce((acc, row) => acc + row.valueAtomic, 0n);
  if (!input.modeCrazy) {
    return total;
  }
  // In crazy mode lower pulls should produce higher "score" chance/standing.
  return total > 0n ? 1_000_000_000_000_000n / total : 1_000_000_000_000_000n;
};

const toBattleState = (battle: {
  id: string;
  status: BattleStatus;
  template: BattleTemplate;
  modeCrazy: boolean;
  modeGroup: boolean;
  modeJackpot: boolean;
  modeTerminal: boolean;
  modePrivate: boolean;
  modeBorrow: boolean;
  maxCases: number;
  totalCostAtomic: bigint;
  totalPayoutAtomic: bigint;
  winnerTeam: number | null;
  winnerUserId: string | null;
  jackpotWinnerSlotId: string | null;
  jackpotSeed: string | null;
  jackpotRoll: number | null;
  createdByUserId: string;
  createdAt: Date;
  startedAt: Date | null;
  settledAt: Date | null;
  updatedAt: Date;
  cases: Array<{
    id: string;
    caseId: string;
    orderIndex: number;
    priceAtomic: bigint;
    case: { id: string; slug: string; title: string; logoUrl: string | null };
  }>;
  slots: Array<{
    id: string;
    seatIndex: number;
    teamIndex: number;
    state: BattleSlotState;
    userId: string | null;
    displayName: string;
    isBot: boolean;
    borrowPercent: number;
    paidAmountAtomic: bigint;
    payoutAtomic: bigint;
    winWeightAtomic: bigint;
    profitAtomic: bigint;
  }>;
  itemDrops: Array<{
    id: string;
    battleCaseId: string;
    battleSlotId: string;
    roundIndex: number;
    orderIndex: number;
    valueAtomic: bigint;
    caseItem: {
      id: string;
      name: string;
      imageUrl: string | null;
      valueAtomic: bigint;
    };
  }>;
}): BattleState => ({
  id: battle.id,
  status: battle.status,
  template: battle.template,
  modeCrazy: battle.modeCrazy,
  modeGroup: battle.modeGroup,
  modeJackpot: battle.modeJackpot,
  modeTerminal: battle.modeTerminal,
  modePrivate: battle.modePrivate,
  modeBorrow: battle.modeBorrow,
  maxCases: battle.maxCases,
  totalCostAtomic: battle.totalCostAtomic,
  totalPayoutAtomic: battle.totalPayoutAtomic,
  winnerTeam: battle.winnerTeam ?? null,
  winnerUserId: battle.winnerUserId ?? null,
  jackpotWinnerSlotId: battle.jackpotWinnerSlotId ?? null,
  jackpotSeed: battle.jackpotSeed ?? null,
  jackpotRoll: battle.jackpotRoll ?? null,
  createdByUserId: battle.createdByUserId,
  createdAt: battle.createdAt,
  startedAt: battle.startedAt ?? null,
  settledAt: battle.settledAt ?? null,
  updatedAt: battle.updatedAt,
  cases: battle.cases.map((row) => ({
    id: row.id,
    caseId: row.caseId,
    orderIndex: row.orderIndex,
    priceAtomic: row.priceAtomic,
    case: row.case
  })),
  slots: battle.slots.map((row) => ({
    id: row.id,
    seatIndex: row.seatIndex,
    teamIndex: row.teamIndex,
    state: row.state,
    userId: row.userId,
    displayName: row.displayName,
    isBot: row.isBot,
    borrowPercent: row.borrowPercent,
    paidAmountAtomic: row.paidAmountAtomic,
    payoutAtomic: row.payoutAtomic,
    winWeightAtomic: row.winWeightAtomic,
    profitAtomic: row.profitAtomic
  })),
  drops: battle.itemDrops.map((row) => ({
    id: row.id,
    battleCaseId: row.battleCaseId,
    battleSlotId: row.battleSlotId,
    roundIndex: row.roundIndex,
    orderIndex: row.orderIndex,
    valueAtomic: row.valueAtomic,
    caseItem: row.caseItem
  }))
});

const ensureBattleJoinable = (battle: {
  status: BattleStatus;
  slots: Array<{ state: BattleSlotState; userId: string | null }>;
}): void => {
  if (battle.status !== BattleStatus.OPEN) {
    throw new AppError("Battle is not open for joining", 409, "BATTLE_NOT_OPEN");
  }
  const openSeatExists = battle.slots.some((slot) => slot.state === BattleSlotState.OPEN);
  if (!openSeatExists) {
    throw new AppError("Battle is already full", 409, "BATTLE_FULL");
  }
};

const getOpenSlotBySeat = (
  slots: Array<{ seatIndex: number; state: BattleSlotState }>,
  seatIndex?: number
): number => {
  if (typeof seatIndex === "number") {
    const selected = slots.find((row) => row.seatIndex === seatIndex);
    if (!selected || selected.state !== BattleSlotState.OPEN) {
      throw new AppError("Selected seat is not available", 409, "BATTLE_SEAT_UNAVAILABLE");
    }
    return seatIndex;
  }
  const fallback = slots.find((row) => row.state === BattleSlotState.OPEN);
  if (!fallback) {
    throw new AppError("Battle is already full", 409, "BATTLE_FULL");
  }
  return fallback.seatIndex;
};

const maybeSettleBattle = async (battleId: string): Promise<void> => {
  const battle = await getBattleForAction(battleId);
  if (battle.status !== BattleStatus.OPEN) {
    return;
  }
  if (battle.slots.some((slot) => slot.state === BattleSlotState.OPEN)) {
    return;
  }

  const seed = randomUUID();
  await prisma.$transaction(async (tx) => {
    const locked = await tx.battle.findUnique({
      where: { id: battleId },
      include: {
        cases: {
          orderBy: [{ orderIndex: "asc" }]
        },
        slots: {
          orderBy: [{ seatIndex: "asc" }]
        }
      }
    });
    if (!locked) {
      throw new AppError("Battle not found", 404, "BATTLE_NOT_FOUND");
    }
    if (locked.status !== BattleStatus.OPEN) {
      return;
    }
    if (locked.slots.some((slot) => slot.state === BattleSlotState.OPEN)) {
      return;
    }

    await tx.battle.update({
      where: { id: locked.id },
      data: {
        status: BattleStatus.RUNNING,
        startedAt: new Date()
      }
    });

    const dropsBySlot = new Map<string, Array<{ roundIndex: number; valueAtomic: bigint }>>();
    let nonce = 1;
    let totalPayoutAtomic = 0n;
    for (const round of locked.cases) {
      for (const slot of locked.slots) {
        const picked = await pickCaseItemForRound(tx, round.caseId, seed, nonce);
        nonce += 1;
        totalPayoutAtomic += picked.valueAtomic;
        const arr = dropsBySlot.get(slot.id) ?? [];
        arr.push({ roundIndex: round.orderIndex, valueAtomic: picked.valueAtomic });
        dropsBySlot.set(slot.id, arr);
        await tx.battleItemDrop.create({
          data: {
            battleId: locked.id,
            battleCaseId: round.id,
            battleSlotId: slot.id,
            roundIndex: round.orderIndex,
            orderIndex: slot.seatIndex,
            caseItemId: picked.id,
            valueAtomic: picked.valueAtomic
          }
        });
      }
    }

    const slotScores = locked.slots.map((slot) => ({
      slotId: slot.id,
      teamIndex: slot.teamIndex,
      isBot: slot.isBot,
      userId: slot.userId,
      borrowPercent: slot.borrowPercent,
      paidAmountAtomic: slot.paidAmountAtomic,
      scoreAtomic: getSlotOutcomeScore({
        modeTerminal: locked.modeTerminal,
        modeCrazy: locked.modeCrazy,
        dropsBySlot,
        slotId: slot.id
      }),
      valueAtomic: (dropsBySlot.get(slot.id) ?? []).reduce((acc, row) => acc + row.valueAtomic, 0n)
    }));

    let winnerSlots = slotScores;
    let winningTeam: number | null = null;
    let jackpotWinnerSlotId: string | null = null;
    let jackpotRoll: number | null = null;

    if (locked.modeGroup) {
      winnerSlots = slotScores;
    } else if (locked.modeJackpot) {
      const jackpotRows = slotScores.map((slot) => ({
        ...slot,
        jackpotWeight: locked.modeCrazy
          ? jackpotWeightFromValue(slot.scoreAtomic)
          : jackpotWeightFromValue(slot.valueAtomic)
      }));
      jackpotRoll = battleSeedRandom(seed, 999);
      const picked = selectByWeight(jackpotRows, (row) => row.jackpotWeight, jackpotRoll);
      jackpotWinnerSlotId = picked.slotId;
      winnerSlots = slotScores.filter((slot) => slot.slotId === picked.slotId);
      winningTeam = picked.teamIndex;
    } else {
      const byTeam = new Map<number, bigint>();
      for (const row of slotScores) {
        byTeam.set(row.teamIndex, (byTeam.get(row.teamIndex) ?? 0n) + row.scoreAtomic);
      }
      let selectedTeam = slotScores[0]?.teamIndex ?? 0;
      let selectedValue = byTeam.get(selectedTeam) ?? 0n;
      for (const [teamIndex, score] of byTeam.entries()) {
        if (score > selectedValue) {
          selectedTeam = teamIndex;
          selectedValue = score;
        }
      }
      winningTeam = selectedTeam;
      winnerSlots = slotScores.filter((row) => row.teamIndex === selectedTeam);
    }

    const totalPotAtomic = locked.totalCostAtomic;
    const shareNumerator = TEAM_SHARE_NUMERATOR[locked.template] ?? 100n;
    const totalWinnerPoolAtomic = locked.modeGroup ? totalPotAtomic : (totalPotAtomic * shareNumerator) / 100n;
    const splitCount = BigInt(Math.max(1, winnerSlots.length));
    const perWinnerBaseAtomic = totalWinnerPoolAtomic / splitCount;

    for (const slot of slotScores) {
      const isWinner = winnerSlots.some((row) => row.slotId === slot.slotId);
      const payoutBeforeBorrow = isWinner ? perWinnerBaseAtomic : 0n;
      const payoutAtomic = isWinner ? scaleByBorrow(payoutBeforeBorrow, slot.borrowPercent) : 0n;
      const profitAtomic = payoutAtomic - slot.paidAmountAtomic;
      await tx.battleSlot.update({
        where: { id: slot.slotId },
        data: {
          payoutAtomic,
          winWeightAtomic: slot.scoreAtomic,
          profitAtomic
        }
      });
      if (slot.isBot || !slot.userId) {
        continue;
      }
      const betReference = `battle:${locked.id}:seat:${slot.slotId}`;
      if (payoutAtomic > 0n) {
        await tx.wallet.updateMany({
          where: {
            userId: slot.userId,
            currency: PLATFORM_INTERNAL_CURRENCY
          },
          data: {
            balanceAtomic: { increment: payoutAtomic }
          }
        });
        await tx.ledgerEntry.create({
          data: {
            wallet: {
              connect: {
                userId_currency: {
                  userId: slot.userId,
                  currency: PLATFORM_INTERNAL_CURRENCY
                }
              }
            },
            direction: "CREDIT",
            reason: "BET_PAYOUT",
            amountAtomic: payoutAtomic,
            balanceBeforeAtomic: 0n,
            balanceAfterAtomic: 0n,
            idempotencyKey: `battle-payout:${locked.id}:${slot.slotId}`,
            referenceId: betReference,
            metadata: {
              game: "BATTLES",
              operation: "BATTLE_PAYOUT",
              battleId: locked.id,
              slotId: slot.slotId
            } as Prisma.InputJsonValue
          }
        });
      }
    }

    await tx.battle.update({
      where: { id: locked.id },
      data: {
        status: BattleStatus.SETTLED,
        settledAt: new Date(),
        jackpotSeed: locked.modeJackpot ? seed : null,
        jackpotRoll: locked.modeJackpot ? jackpotRoll : null,
        jackpotWinnerSlotId,
        winnerTeam: winningTeam,
        winnerUserId: winnerSlots.find((row) => !row.isBot)?.userId ?? null,
        totalPayoutAtomic
      }
    });
  });
};

export const createBattle = async (input: BattleCreateInput): Promise<BattleState> => {
  try {
    await ensureBattlesSchemaReady();

    const templateDef = battleTemplateSeats(input.template);
    validateModes(input.template, input);

  if (!Array.isArray(input.cases) || input.cases.length < 1 || input.cases.length > BATTLE_MAX_CASES) {
    throw new AppError(`Battle must include between 1 and ${BATTLE_MAX_CASES} cases`, 400, "BATTLE_CASES_INVALID");
  }

  const uniqueCaseIds = Array.from(new Set(input.cases));
  const cases = await prisma.case.findMany({
    where: {
      id: { in: uniqueCaseIds },
      isActive: true,
      currency: PLATFORM_INTERNAL_CURRENCY
    },
    select: {
      id: true,
      slug: true,
      title: true,
      logoUrl: true,
      priceAtomic: true
    }
  });
  if (cases.length !== uniqueCaseIds.length) {
    throw new AppError("One or more cases are missing or inactive", 404, "BATTLE_CASE_NOT_FOUND");
  }
  const caseMap = new Map(cases.map((row) => [row.id, row]));
  const selectedCases = input.cases.map((caseId) => {
    const value = caseMap.get(caseId);
    if (!value) {
      throw new AppError("One or more cases are missing or inactive", 404, "BATTLE_CASE_NOT_FOUND");
    }
    return value;
  });
  const totalCasePrice = selectedCases.reduce((acc, row) => acc + row.priceAtomic, 0n);
  if (totalCasePrice <= 0n) {
    throw new AppError("Total case price must be positive", 400, "BATTLE_TOTAL_PRICE_INVALID");
  }
  if (totalCasePrice > MAX_GAME_BET_ATOMIC) {
    throw new AppError("You can't bet more than 5000 per game", 400, "BET_LIMIT_EXCEEDED");
  }

  const creatorBorrowPercent = normalizeBorrowPercent(input.creatorBorrowPercent, Boolean(input.modeBorrow));
  const creatorPayAtomic = scaleByBorrow(totalCasePrice, creatorBorrowPercent);

    const createToken = randomUUID();
    const creatorSeat = 0;
    const creatorBetReference = `battle:create:${createToken}:seat:${creatorSeat}`;
    const hold = await holdFundsForBet({
      actorUserId: input.userId,
      userId: input.userId,
      currency: PLATFORM_INTERNAL_CURRENCY,
      betReference: creatorBetReference,
      amountAtomic: creatorPayAtomic,
      idempotencyKey: `battle-create:${createToken}:${input.userId}`,
      metadata: {
        game: "BATTLES",
        operation: "BATTLE_JOIN",
        seatIndex: creatorSeat,
        borrowPercent: creatorBorrowPercent
      }
    });

    let created: string | null = null;
    try {
      created = await prisma.$transaction(async (tx) => {
        const battle = await tx.battle.create({
          data: {
            template: input.template,
            modeCrazy: Boolean(input.modeCrazy),
            modeGroup: Boolean(input.modeGroup),
            modeJackpot: Boolean(input.modeJackpot),
            modeTerminal: Boolean(input.modeTerminal),
            modePrivate: Boolean(input.modePrivate),
            modeBorrow: Boolean(input.modeBorrow),
            createdByUserId: input.userId,
            maxCases: BATTLE_MAX_CASES,
            totalCostAtomic: totalCasePrice * BigInt(templateDef.seats)
          }
        });

        await tx.battleCase.createMany({
          data: selectedCases.map((row, idx) => ({
            battleId: battle.id,
            caseId: row.id,
            orderIndex: idx,
            priceAtomic: row.priceAtomic
          }))
        });

        const slots = Array.from({ length: templateDef.seats }, (_, seatIndex) => {
          const teamIndex = computeSeatTeam(input.template, seatIndex);
          if (seatIndex === creatorSeat) {
            return {
              battleId: battle.id,
              seatIndex,
              teamIndex,
              state: BattleSlotState.JOINED,
              userId: input.userId,
              displayName: `User #${input.userId.slice(0, 6)}`,
              isBot: false,
              borrowPercent: creatorBorrowPercent,
              paidAmountAtomic: hold.reservation.amountAtomic
            };
          }
          return {
            battleId: battle.id,
            seatIndex,
            teamIndex,
            state: BattleSlotState.OPEN,
            userId: null,
            displayName: "Waiting...",
            isBot: false,
            borrowPercent: 100,
            paidAmountAtomic: 0n
          };
        });
        await tx.battleSlot.createMany({ data: slots });
        return battle.id;
      });

      // Read battle state before capture so any read-side schema errors
      // are handled without charging the user.
      const createdState = await getBattleById(created, input.userId);

      await captureHeldFunds({
        actorUserId: input.userId,
        userId: input.userId,
        currency: PLATFORM_INTERNAL_CURRENCY,
        betReference: creatorBetReference,
        idempotencyKey: `battle-capture:${createToken}:${input.userId}`
      });

      try {
        await addUserXpBestEffort(input.userId, hold.reservation.amountAtomic);
      } catch {
        // Best-effort only, never block battle creation.
      }
      void addAffiliateCommissionBestEffort(
        input.userId,
        hold.reservation.amountAtomic,
        BATTLE_AFFILIATE_SOURCE,
        `battle-aff:${createToken}:${input.userId}:create`
      );

      return createdState;
    } catch (error) {
      // If create/capture fails, do not leave user charged.
      try {
        await releaseHeldFunds({
          actorUserId: input.userId,
          userId: input.userId,
          currency: PLATFORM_INTERNAL_CURRENCY,
          betReference: creatorBetReference,
          idempotencyKey: `battle-release:${createToken}:${input.userId}`
        });
      } catch {
        // Ignore compensation failures; original error is surfaced.
      }

      if (created) {
        try {
          await prisma.battle.delete({ where: { id: created } });
        } catch {
          // Best-effort cleanup only.
        }
      }
      throw error;
    }
  } catch (error) {
    if (isMissingBattlesSchemaError(error)) {
      throw battlesNotReadyError();
    }
    throw error;
  }
};

export const joinBattle = async (input: {
  userId: string;
  battleId: string;
  seatIndex?: number;
  borrowPercent?: number;
}): Promise<BattleState> => {
  try {
    await ensureBattlesSchemaReady();

    const battle = await getBattleForAction(input.battleId);
    ensureBattleJoinable(battle);
    if (battle.slots.some((slot) => slot.userId === input.userId)) {
      throw new AppError("You are already in this battle", 409, "BATTLE_ALREADY_JOINED");
    }

    const seatIndex = getOpenSlotBySeat(
      battle.slots.map((slot) => ({ seatIndex: slot.seatIndex, state: slot.state })),
      input.seatIndex
    );
    const borrowPercent = normalizeBorrowPercent(input.borrowPercent, battle.modeBorrow);
    const payAtomic = scaleByBorrow(
      battle.cases.reduce((acc, row) => acc + row.priceAtomic, 0n),
      borrowPercent
    );
    if (payAtomic <= 0n) {
      throw new AppError("Join amount must be positive", 400, "BATTLE_JOIN_AMOUNT_INVALID");
    }
    if (payAtomic > MAX_GAME_BET_ATOMIC) {
      throw new AppError("You can't bet more than 5000 per game", 400, "BET_LIMIT_EXCEEDED");
    }

    const betReference = `battle:${battle.id}:seat:${seatIndex}`;
    const hold = await holdFundsForBet({
      actorUserId: input.userId,
      userId: input.userId,
      currency: PLATFORM_INTERNAL_CURRENCY,
      betReference,
      amountAtomic: payAtomic,
      idempotencyKey: `battle-join:${battle.id}:${input.userId}:${seatIndex}`,
      metadata: {
        game: "BATTLES",
        operation: "BATTLE_JOIN",
        battleId: battle.id,
        seatIndex,
        borrowPercent
      }
    });

    const claim = await prisma.battleSlot.updateMany({
      where: {
        battleId: battle.id,
        seatIndex,
        state: BattleSlotState.OPEN
      },
      data: {
        state: BattleSlotState.JOINED,
        userId: input.userId,
        displayName: `User #${input.userId.slice(0, 6)}`,
        isBot: false,
        borrowPercent,
        paidAmountAtomic: hold.reservation.amountAtomic,
        joinedAt: new Date()
      }
    });
    if (claim.count === 0) {
      await releaseHeldFunds({
        actorUserId: input.userId,
        userId: input.userId,
        currency: PLATFORM_INTERNAL_CURRENCY,
        betReference,
        idempotencyKey: `battle-join-release:${battle.id}:${input.userId}:${seatIndex}`
      });
      throw new AppError("Selected seat is not available", 409, "BATTLE_SEAT_UNAVAILABLE");
    }

    try {
      await captureHeldFunds({
        actorUserId: input.userId,
        userId: input.userId,
        currency: PLATFORM_INTERNAL_CURRENCY,
        betReference,
        idempotencyKey: `battle-capture:${battle.id}:${input.userId}:${seatIndex}`
      });
    } catch (captureError) {
      await prisma.battleSlot.updateMany({
        where: {
          battleId: battle.id,
          seatIndex,
          userId: input.userId
        },
        data: {
          state: BattleSlotState.OPEN,
          userId: null,
          displayName: "Waiting...",
          isBot: false,
          borrowPercent: 100,
          paidAmountAtomic: 0n,
          joinedAt: null
        }
      });
      try {
        await releaseHeldFunds({
          actorUserId: input.userId,
          userId: input.userId,
          currency: PLATFORM_INTERNAL_CURRENCY,
          betReference,
          idempotencyKey: `battle-capture-release:${battle.id}:${input.userId}:${seatIndex}`
        });
      } catch {
        // Best-effort compensation only.
      }
      throw captureError;
    }

    await addUserXpBestEffort(input.userId, hold.reservation.amountAtomic);
    void addAffiliateCommissionBestEffort(
      input.userId,
      hold.reservation.amountAtomic,
      BATTLE_AFFILIATE_SOURCE,
      `battle-aff:${battle.id}:${input.userId}:join:${seatIndex}`
    );

    await maybeSettleBattle(battle.id);
    return getBattleById(battle.id, input.userId);
  } catch (error) {
    if (isMissingBattlesSchemaError(error)) {
      throw battlesNotReadyError();
    }
    throw error;
  }
};

const fillBotIntoSeat = async (battle: Awaited<ReturnType<typeof getBattleForAction>>, seatIndex: number) => {
  const seat = battle.slots.find((row) => row.seatIndex === seatIndex);
  if (!seat || seat.state !== BattleSlotState.OPEN) {
    throw new AppError("Seat is not available for bot", 409, "BATTLE_SEAT_UNAVAILABLE");
  }
  const paidAmountAtomic = battle.cases.reduce((acc, row) => acc + row.priceAtomic, 0n);
  await prisma.battleSlot.update({
    where: {
      battleId_seatIndex: {
        battleId: battle.id,
        seatIndex
      }
    },
    data: {
      state: BattleSlotState.BOT_FILLED,
      userId: null,
      displayName: randomBotName(),
      isBot: true,
      borrowPercent: 100,
      paidAmountAtomic,
      joinedAt: new Date()
    }
  });
};

export const callBotForSeat = async (input: {
  userId: string;
  battleId: string;
  seatIndex: number;
}): Promise<BattleState> => {
  try {
    const battle = await getBattleForAction(input.battleId);
    ensureBattleJoinable(battle);
    if (!battle.slots.some((slot) => slot.userId === input.userId)) {
      throw new AppError("Only participants can call bots", 403, "BATTLE_CALL_BOT_FORBIDDEN");
    }
    await fillBotIntoSeat(battle, input.seatIndex);
    await maybeSettleBattle(battle.id);
    return getBattleById(battle.id, input.userId);
  } catch (error) {
    if (isMissingBattlesSchemaError(error)) {
      throw battlesNotReadyError();
    }
    throw error;
  }
};

export const fillBots = async (input: { userId: string; battleId: string }): Promise<BattleState> => {
  try {
    const battle = await getBattleForAction(input.battleId);
    ensureBattleJoinable(battle);
    if (!battle.slots.some((slot) => slot.userId === input.userId)) {
      throw new AppError("Only participants can fill bots", 403, "BATTLE_FILL_BOTS_FORBIDDEN");
    }
    const openSeats = battle.slots.filter((slot) => slot.state === BattleSlotState.OPEN).map((slot) => slot.seatIndex);
    for (const seatIndex of openSeats) {
      await fillBotIntoSeat(battle, seatIndex);
    }
    await maybeSettleBattle(battle.id);
    return getBattleById(battle.id, input.userId);
  } catch (error) {
    if (isMissingBattlesSchemaError(error)) {
      throw battlesNotReadyError();
    }
    throw error;
  }
};

export const getBattleById = async (
  battleId: string,
  viewerUserId?: string,
  isAdmin = false
): Promise<BattleState> => {
  try {
    const battle = await prisma.battle.findUnique({
      where: { id: battleId },
      include: {
        cases: {
          include: {
            case: {
              select: {
                id: true,
                slug: true,
                title: true,
                logoUrl: true
              }
            }
          },
          orderBy: [{ orderIndex: "asc" }]
        },
        slots: {
          orderBy: [{ seatIndex: "asc" }]
        },
        itemDrops: {
          include: {
            caseItem: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
                valueAtomic: true
              }
            }
          },
          orderBy: [{ roundIndex: "asc" }, { orderIndex: "asc" }]
        }
      }
    });
    if (!battle) {
      throw new AppError("Battle not found", 404, "BATTLE_NOT_FOUND");
    }
    if (battle.modePrivate && !isAdmin) {
      const allowed =
        (viewerUserId && battle.createdByUserId === viewerUserId) ||
        battle.slots.some((slot) => slot.userId && viewerUserId && slot.userId === viewerUserId);
      if (!allowed) {
        throw new AppError("Battle not found", 404, "BATTLE_NOT_FOUND");
      }
    }
    return toBattleState(battle);
  } catch (error) {
    if (isMissingBattlesSchemaError(error)) {
      throw battlesNotReadyError();
    }
    throw error;
  }
};

export type BattleListInput = {
  includePrivate?: boolean;
  status?: BattleStatus;
  limit?: number;
  userId?: string;
};

export const listBattles = async (input: BattleListInput): Promise<BattleState[]> => {
  try {
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 30)));
    const rows = await prisma.battle.findMany({
      where: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.includePrivate
          ? {}
          : {
              OR: [{ modePrivate: false }, ...(input.userId ? [{ createdByUserId: input.userId }] : [])]
            })
      },
      include: {
        cases: {
          include: {
            case: {
              select: {
                id: true,
                slug: true,
                title: true,
                logoUrl: true
              }
            }
          },
          orderBy: [{ orderIndex: "asc" }]
        },
        slots: {
          orderBy: [{ seatIndex: "asc" }]
        },
        itemDrops: {
          include: {
            caseItem: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
                valueAtomic: true
              }
            }
          },
          orderBy: [{ roundIndex: "asc" }, { orderIndex: "asc" }]
        }
      },
      orderBy: [{ createdAt: "desc" }],
      take: limit
    });
    return rows.map(toBattleState);
  } catch (error) {
    if (isMissingBattlesSchemaError(error)) {
      return [];
    }
    throw error;
  }
};

export const callBotIntoBattle = callBotForSeat;
export const fillBotsIntoBattle = fillBots;
