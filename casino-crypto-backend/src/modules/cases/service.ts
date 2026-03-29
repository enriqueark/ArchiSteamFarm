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
import { addAffiliateCommissionBestEffort } from "../affiliates/service";
import { addUserXpBestEffort } from "../progression/service";
import {
  MAX_GAME_BET_ATOMIC,
  PLATFORM_INTERNAL_CURRENCY,
  debitBalanceInTx
} from "../wallets/service";

const RNG_BYTES = 6;
const RNG_MAX = 2 ** (RNG_BYTES * 8);

const generateServerSeed = (): string => randomBytes(32).toString("hex");
const hashServerSeed = (serverSeed: string): string =>
  createHash("sha256").update(serverSeed).digest("hex");
const generateClientSeed = (): string => randomUUID();
const deterministicRandom = (
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  round: number
): number => {
  const digest = createHmac("sha256", serverSeed).update(`${clientSeed}:${nonce}:${round}`).digest();
  const int = digest.readUIntBE(0, RNG_BYTES);
  return int / RNG_MAX;
};

const isMissingCasesSchemaError = (error: unknown): boolean => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  ) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const msg = error.message.toLowerCase();
  return (
    msg.includes("case_") ||
    msg.includes(" relation \"cases\"") ||
    msg.includes(" relation \"case_items\"") ||
    msg.includes(" relation \"case_openings\"")
  );
};

export type CaseListItem = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  priceAtomic: bigint;
  currency: Currency;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  itemCount: number;
};

type CaseItemState = {
  id: string;
  name: string;
  valueAtomic: bigint;
  dropRate: string;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type CaseDetails = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  priceAtomic: bigint;
  currency: Currency;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  items: CaseItemState[];
};

type WalletSnapshot = {
  walletId: string;
  balanceAtomic: bigint;
  lockedAtomic: bigint;
};

type OpenCaseInput = {
  userId: string;
  caseId: string;
  idempotencyKey: string;
};

export type CaseOpenResult = {
  openingId: string;
  caseId: string;
  caseSlug: string;
  caseTitle: string;
  item: CaseItemState;
  topTierEligible: boolean;
  topTierItems: CaseItemState[];
  roll: number;
  payoutAtomic: bigint;
  profitAtomic: bigint;
  priceAtomic: bigint;
  currency: Currency;
  provablyFair: {
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
  };
  wallet: WalletSnapshot;
  createdAt: Date;
};

export type CasesSimulationResult = {
  caseId: string;
  rounds: number;
  spentAtomic: bigint;
  payoutAtomic: bigint;
  profitAtomic: bigint;
  rtpPercent: number;
  hitTopTierCount: number;
};

type UpsertCaseInput = {
  actorUserId: string;
  caseId?: string;
  slug: string;
  title: string;
  description?: string | null;
  priceAtomic: bigint;
  currency?: Currency;
  isActive: boolean;
  items: Array<{
    name: string;
    valueAtomic: bigint;
    dropRate: string;
    imageUrl?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  }>;
};

type CaseForOpen = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  priceAtomic: bigint;
  currency: Currency;
  isActive: boolean;
  items: Array<{
    id: string;
    name: string;
    valueAtomic: bigint;
    dropRate: Prisma.Decimal;
    imageUrl: string | null;
    sortOrder: number;
    isActive: boolean;
  }>;
};

const ensureInternalCurrency = (currency: Currency): void => {
  if (currency !== PLATFORM_INTERNAL_CURRENCY) {
    throw new AppError(
      `Only ${PLATFORM_INTERNAL_CURRENCY} is supported as internal virtual currency`,
      400,
      "UNSUPPORTED_CURRENCY"
    );
  }
};

const asItemState = (item: {
  id: string;
  name: string;
  valueAtomic: bigint;
  dropRate: Prisma.Decimal;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
}): CaseItemState => ({
  id: item.id,
  name: item.name,
  valueAtomic: item.valueAtomic,
  dropRate: item.dropRate.toFixed(8),
  imageUrl: item.imageUrl,
  sortOrder: item.sortOrder,
  isActive: item.isActive
});

const validateDropRates = (items: Array<{ dropRate: Prisma.Decimal }>): void => {
  if (!items.length) {
    throw new AppError("A case must have at least one item", 400, "CASE_ITEMS_REQUIRED");
  }
  let sum = 0;
  for (const item of items) {
    const value = Number(item.dropRate.toString());
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      throw new AppError("Each item dropRate must be > 0 and <= 100", 400, "INVALID_CASE_DROP_RATE");
    }
    sum += value;
  }
  const delta = Math.abs(sum - 100);
  if (delta > 0.0001) {
    throw new AppError("Case item drop rates must sum exactly to 100", 400, "CASE_DROP_RATE_SUM_INVALID");
  }
};

const pickCaseItem = (
  items: Array<{
    id: string;
    name: string;
    valueAtomic: bigint;
    dropRate: Prisma.Decimal;
    imageUrl: string | null;
    sortOrder: number;
    isActive: boolean;
  }>,
  roll: number
) => {
  let cumulative = 0;
  for (const item of items) {
    cumulative += Number(item.dropRate.toString());
    if (roll * 100 <= cumulative + 0.00000001) {
      return item;
    }
  }
  return items[items.length - 1];
};

const computeTopTierThreshold = (
  items: Array<{
    id: string;
    name: string;
    valueAtomic: bigint;
    dropRate: Prisma.Decimal;
  }>
): bigint => {
  const sortedValues = [...items].map((i) => i.valueAtomic).sort((a, b) => (a > b ? 1 : -1));
  const idx = Math.max(0, Math.floor(sortedValues.length * 0.95) - 1);
  return sortedValues[idx] ?? 0n;
};

const getTopTierItems = (
  items: Array<{
    id: string;
    name: string;
    valueAtomic: bigint;
    dropRate: Prisma.Decimal;
    imageUrl: string | null;
    sortOrder: number;
    isActive: boolean;
  }>
): CaseItemState[] => {
  const threshold = computeTopTierThreshold(items);
  return items
    .filter((item) => item.valueAtomic >= threshold)
    .map(asItemState);
};

const ensureProvablyFairContext = async (
  tx: Prisma.TransactionClient,
  userId: string
): Promise<{
  profile: { userId: string; clientSeed: string; nonce: number; activeSeedId: string };
  activeSeed: { id: string; serverSeed: string; serverSeedHash: string; status: "ACTIVE" | "REVEALED" };
}> => {
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

const getCaseForOpen = async (caseId: string): Promise<CaseForOpen> => {
  const selected = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      items: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      }
    }
  });
  if (!selected || !selected.isActive) {
    throw new AppError("Case not found", 404, "CASE_NOT_FOUND");
  }
  if (!selected.items.length) {
    throw new AppError("Case has no active items", 409, "CASE_WITHOUT_ITEMS");
  }
  ensureInternalCurrency(selected.currency);
  validateDropRates(selected.items);
  return selected as CaseForOpen;
};

export const listCases = async (): Promise<CaseListItem[]> => {
  const rows = await prisma.case
    .findMany({
      where: {
        isActive: true,
        currency: PLATFORM_INTERNAL_CURRENCY
      },
      orderBy: [{ createdAt: "desc" }],
      include: {
        _count: {
          select: { items: true }
        }
      }
    })
    .catch((error) => {
      if (isMissingCasesSchemaError(error)) {
        return [];
      }
      throw error;
    });
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    priceAtomic: row.priceAtomic,
    currency: row.currency,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    itemCount: row._count.items
  }));
};

export const getCaseById = async (
  caseId: string,
  includeInactive = false
): Promise<CaseDetails> => {
  const selected = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      items: includeInactive
        ? {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
          }
        : {
            where: { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
          }
    }
  });
  if (!selected || (!includeInactive && !selected.isActive)) {
    throw new AppError("Case not found", 404, "CASE_NOT_FOUND");
  }
  ensureInternalCurrency(selected.currency);
  if (!includeInactive) {
    validateDropRates(selected.items);
  } else if (selected.items.some((item) => item.isActive)) {
    validateDropRates(selected.items.filter((item) => item.isActive));
  }
  return {
    id: selected.id,
    slug: selected.slug,
    title: selected.title,
    description: selected.description,
    priceAtomic: selected.priceAtomic,
    currency: selected.currency,
    isActive: selected.isActive,
    createdAt: selected.createdAt,
    updatedAt: selected.updatedAt,
    items: selected.items.map(asItemState)
  };
};

export const openCase = async (input: OpenCaseInput): Promise<CaseOpenResult> => {
  const selectedCase = await getCaseForOpen(input.caseId);
  const topTierItems = getTopTierItems(selectedCase.items);
  if (selectedCase.priceAtomic <= 0n) {
    throw new AppError("Case price must be greater than 0", 409, "CASE_PRICE_INVALID");
  }
  if (selectedCase.priceAtomic > MAX_GAME_BET_ATOMIC) {
    throw new AppError("You can't bet more than 5000 per game", 400, "BET_LIMIT_EXCEEDED");
  }

  const existing = await prisma.caseOpening.findFirst({
    where: {
      userId: input.userId,
      betReservation: {
        is: {
          holdIdempotencyKey: input.idempotencyKey
        }
      }
    },
    include: {
      case: true,
      caseItem: true,
      betReservation: { select: { walletId: true } }
    }
  });
  if (existing) {
    const wallet = await prisma.wallet.findUnique({
      where: { id: existing.betReservation.walletId },
      select: { id: true, balanceAtomic: true, lockedAtomic: true }
    });
    if (!wallet) {
      throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
    }
    return {
      openingId: existing.id,
      caseId: existing.caseId,
      caseSlug: existing.case.slug,
      caseTitle: existing.case.title,
      item: asItemState(existing.caseItem),
      topTierEligible: existing.topTierEligible,
      topTierItems,
      roll: existing.roll,
      payoutAtomic: existing.payoutAtomic,
      profitAtomic: existing.profitAtomic,
      priceAtomic: existing.priceAtomic,
      currency: existing.currency,
      provablyFair: {
        serverSeedHash: existing.serverSeedHash,
        clientSeed: existing.clientSeed,
        nonce: existing.nonce
      },
      wallet: {
        walletId: wallet.id,
        balanceAtomic: wallet.balanceAtomic,
        lockedAtomic: wallet.lockedAtomic
      },
      createdAt: existing.createdAt
    };
  }

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
      throw new AppError("Unable to allocate provably fair nonce", 500, "CASES_NONCE_ALLOCATION_FAILED");
    }
    const seed = await tx.provablyFairSeed.findUnique({
      where: { id: nonceState.activeSeedId }
    });
    if (!seed || seed.status !== "ACTIVE") {
      throw new AppError("Active server seed not found", 500, "ACTIVE_SERVER_SEED_NOT_FOUND");
    }

    const walletDebit = await debitBalanceInTx(tx, {
      userId: input.userId,
      currency: selectedCase.currency,
      amountAtomic: selectedCase.priceAtomic,
      lockAmountAtomic: selectedCase.priceAtomic
    });

    const betReference = `cases:${selectedCase.id}:${randomUUID()}`;
    const holdEntry = await tx.ledgerEntry.create({
      data: {
        walletId: walletDebit.walletId,
        direction: LedgerDirection.DEBIT,
        reason: LedgerReason.BET_HOLD,
        amountAtomic: selectedCase.priceAtomic,
        balanceBeforeAtomic: walletDebit.balanceBeforeAtomic,
        balanceAfterAtomic: walletDebit.balanceAtomic,
        idempotencyKey: input.idempotencyKey,
        referenceId: betReference,
        metadata: {
          game: "CASES",
          operation: "HOLD",
          caseId: selectedCase.id
        } as Prisma.InputJsonValue
      }
    });

    const reservation = await tx.betReservation.create({
      data: {
        userId: input.userId,
        walletId: walletDebit.walletId,
        currency: selectedCase.currency,
        betReference,
        amountAtomic: selectedCase.priceAtomic,
        status: BetReservationStatus.HELD,
        holdIdempotencyKey: input.idempotencyKey,
        holdTransactionId: holdEntry.id,
        metadata: {
          game: "CASES",
          caseId: selectedCase.id
        } as Prisma.InputJsonValue
      }
    });

    const roll = deterministicRandom(seed.serverSeed, nonceState.clientSeed, nonceState.nonce, 0);
    const dropped = pickCaseItem(selectedCase.items, roll);
    const payoutAtomic = dropped.valueAtomic;
    const profitAtomic = payoutAtomic - selectedCase.priceAtomic;
    const topTierThreshold = computeTopTierThreshold(selectedCase.items);
    const topTierEligible = dropped.valueAtomic >= topTierThreshold;

    const opening = await tx.caseOpening.create({
      data: {
        userId: input.userId,
        caseId: selectedCase.id,
        caseItemId: dropped.id,
        currency: selectedCase.currency,
        priceAtomic: selectedCase.priceAtomic,
        payoutAtomic,
        profitAtomic,
        betReference,
        betReservationId: reservation.id,
        serverSeedId: seed.id,
        serverSeedHash: seed.serverSeedHash,
        clientSeed: nonceState.clientSeed,
        nonce: nonceState.nonce,
        roll,
        topTierEligible
      },
      include: {
        case: true,
        caseItem: true,
        betReservation: { select: { walletId: true } }
      }
    });

    const transition = await tx.betReservation.updateMany({
      where: {
        id: reservation.id,
        status: BetReservationStatus.HELD
      },
      data: {
        status: BetReservationStatus.CAPTURED,
        captureIdempotencyKey: `cases:${opening.id}:capture`,
        capturedAt: new Date()
      }
    });
    if (transition.count === 0) {
      throw new AppError("Bet reservation state conflict", 409, "BET_RESERVATION_STATE_CONFLICT");
    }

    const walletCaptureRows = await tx.$queryRaw<Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>>`
      UPDATE "wallets"
      SET "lockedAtomic" = "lockedAtomic" - ${selectedCase.priceAtomic},
          "updatedAt" = NOW()
      WHERE "id" = ${walletDebit.walletId}
        AND "lockedAtomic" >= ${selectedCase.priceAtomic}
      RETURNING id, "balanceAtomic", "lockedAtomic"
    `;
    const walletCaptured = walletCaptureRows[0];
    if (!walletCaptured) {
      throw new AppError("Wallet lock invariant violated", 409, "WALLET_LOCK_INVARIANT_VIOLATED");
    }

    await tx.ledgerEntry.create({
      data: {
        walletId: walletDebit.walletId,
        direction: LedgerDirection.DEBIT,
        reason: LedgerReason.BET_CAPTURE,
        amountAtomic: selectedCase.priceAtomic,
        balanceBeforeAtomic: walletCaptured.balanceAtomic,
        balanceAfterAtomic: walletCaptured.balanceAtomic,
        idempotencyKey: `cases:${opening.id}:capture`,
        referenceId: betReference,
        metadata: {
          game: "CASES",
          operation: "CAPTURE",
          caseId: selectedCase.id
        } as Prisma.InputJsonValue
      }
    });
    await tx.betReservation.update({
      where: { id: reservation.id },
      data: {
        captureTransactionId: null
      }
    });

    const walletPayoutRows = await tx.$queryRaw<Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>>`
      UPDATE "wallets"
      SET "balanceAtomic" = "balanceAtomic" + ${payoutAtomic},
          "updatedAt" = NOW()
      WHERE "id" = ${walletDebit.walletId}
      RETURNING id, "balanceAtomic", "lockedAtomic"
    `;
    const walletPaid = walletPayoutRows[0];
    if (!walletPaid) {
      throw new AppError("Wallet payout failed", 500, "WALLET_PAYOUT_FAILED");
    }

    await tx.ledgerEntry.create({
      data: {
        walletId: walletDebit.walletId,
        direction: LedgerDirection.CREDIT,
        reason: LedgerReason.BET_PAYOUT,
        amountAtomic: payoutAtomic,
        balanceBeforeAtomic: walletPaid.balanceAtomic - payoutAtomic,
        balanceAfterAtomic: walletPaid.balanceAtomic,
        idempotencyKey: `cases:${opening.id}:payout`,
        referenceId: betReference,
        metadata: {
          game: "CASES",
          operation: "PAYOUT",
          caseId: selectedCase.id,
          itemId: dropped.id
        } as Prisma.InputJsonValue
      }
    });

    return {
      opening,
      wallet: {
        walletId: walletPaid.id,
        balanceAtomic: walletPaid.balanceAtomic,
        lockedAtomic: walletPaid.lockedAtomic
      }
    };
  });

  void addUserXpBestEffort(input.userId, selectedCase.priceAtomic);
  void addAffiliateCommissionBestEffort(
    input.userId,
    selectedCase.priceAtomic,
    "CASES",
    `aff:commission:cases:${result.opening.id}`
  );

  return {
    openingId: result.opening.id,
    caseId: result.opening.caseId,
    caseSlug: result.opening.case.slug,
    caseTitle: result.opening.case.title,
    item: asItemState(result.opening.caseItem),
    topTierEligible: result.opening.topTierEligible,
    topTierItems,
    roll: result.opening.roll,
    payoutAtomic: result.opening.payoutAtomic,
    profitAtomic: result.opening.profitAtomic,
    priceAtomic: result.opening.priceAtomic,
    currency: result.opening.currency,
    provablyFair: {
      serverSeedHash: result.opening.serverSeedHash,
      clientSeed: result.opening.clientSeed,
      nonce: result.opening.nonce
    },
    wallet: result.wallet,
    createdAt: result.opening.createdAt
  };
};

export const listMyCaseOpenings = async (userId: string, limit: number): Promise<CaseOpenResult[]> => {
  const rows = await prisma.caseOpening.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      caseItem: true,
      case: {
        include: {
          items: {
            where: { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
          }
        }
      },
      betReservation: { select: { walletId: true } }
    }
  });

  const walletById = new Map<string, WalletSnapshot>();
  const walletIds = Array.from(new Set(rows.map((r) => r.betReservation.walletId)));
  if (walletIds.length) {
    const wallets = await prisma.wallet.findMany({
      where: { id: { in: walletIds } },
      select: { id: true, balanceAtomic: true, lockedAtomic: true }
    });
    for (const wallet of wallets) {
      walletById.set(wallet.id, {
        walletId: wallet.id,
        balanceAtomic: wallet.balanceAtomic,
        lockedAtomic: wallet.lockedAtomic
      });
    }
  }

  return rows.map((row) => ({
    openingId: row.id,
    caseId: row.caseId,
    caseSlug: row.case.slug,
    caseTitle: row.case.title,
    item: asItemState(row.caseItem),
    topTierEligible: row.topTierEligible,
    topTierItems: getTopTierItems(
      row.case.items.map((item) => ({
        id: item.id,
        name: item.name,
        valueAtomic: item.valueAtomic,
        dropRate: item.dropRate,
        imageUrl: item.imageUrl,
        sortOrder: item.sortOrder,
        isActive: item.isActive
      }))
    ),
    roll: row.roll,
    payoutAtomic: row.payoutAtomic,
    profitAtomic: row.profitAtomic,
    priceAtomic: row.priceAtomic,
    currency: row.currency,
    provablyFair: {
      serverSeedHash: row.serverSeedHash,
      clientSeed: row.clientSeed,
      nonce: row.nonce
    },
    wallet: walletById.get(row.betReservation.walletId) ?? {
      walletId: row.betReservation.walletId,
      balanceAtomic: 0n,
      lockedAtomic: 0n
    },
    createdAt: row.createdAt
  }));
};

const normalizeCaseSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const upsertCaseByAdmin = async (input: UpsertCaseInput): Promise<CaseDetails> => {
  const slug = normalizeCaseSlug(input.slug);
  if (!slug || slug.length < 3 || slug.length > 64) {
    throw new AppError("Invalid case slug", 400, "INVALID_CASE_SLUG");
  }
  ensureInternalCurrency(input.currency ?? PLATFORM_INTERNAL_CURRENCY);
  if (input.priceAtomic <= 0n) {
    throw new AppError("Case price must be greater than 0", 400, "INVALID_CASE_PRICE");
  }
  if (input.priceAtomic > MAX_GAME_BET_ATOMIC) {
    throw new AppError("You can't bet more than 5000 per game", 400, "BET_LIMIT_EXCEEDED");
  }
  if (!input.items.length) {
    throw new AppError("A case must include at least one item", 400, "CASE_ITEMS_REQUIRED");
  }

  const normalizedItems = input.items.map((item, idx) => {
    if (!item.name.trim()) {
      throw new AppError("Case item name is required", 400, "INVALID_CASE_ITEM_NAME");
    }
    if (item.valueAtomic < 0n) {
      throw new AppError("Case item valueAtomic cannot be negative", 400, "INVALID_CASE_ITEM_VALUE");
    }
    const parsedDrop = new Prisma.Decimal(item.dropRate);
    return {
      name: item.name.trim(),
      valueAtomic: item.valueAtomic,
      dropRate: parsedDrop,
      imageUrl: item.imageUrl ?? null,
      sortOrder: item.sortOrder ?? idx,
      isActive: item.isActive ?? true
    };
  });
  validateDropRates(normalizedItems);

  const saved = await prisma.$transaction(async (tx) => {
    if (input.caseId) {
      const existing = await tx.case.findUnique({
        where: { id: input.caseId },
        select: { id: true }
      });
      if (!existing) {
        throw new AppError("Case not found", 404, "CASE_NOT_FOUND");
      }

      const updatedCase = await tx.case.update({
        where: { id: input.caseId },
        data: {
          slug,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          priceAtomic: input.priceAtomic,
          currency: input.currency ?? PLATFORM_INTERNAL_CURRENCY,
          isActive: input.isActive
        }
      });

      await tx.caseItem.deleteMany({ where: { caseId: updatedCase.id } });
      await tx.caseItem.createMany({
        data: normalizedItems.map((item) => ({
          caseId: updatedCase.id,
          name: item.name,
          valueAtomic: item.valueAtomic,
          dropRate: item.dropRate,
          imageUrl: item.imageUrl,
          sortOrder: item.sortOrder,
          isActive: item.isActive
        }))
      });

      return updatedCase.id;
    }

    const created = await tx.case.create({
      data: {
        slug,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        priceAtomic: input.priceAtomic,
        currency: input.currency ?? PLATFORM_INTERNAL_CURRENCY,
        isActive: input.isActive,
        createdByUserId: input.actorUserId
      }
    });

    await tx.caseItem.createMany({
      data: normalizedItems.map((item) => ({
        caseId: created.id,
        name: item.name,
        valueAtomic: item.valueAtomic,
        dropRate: item.dropRate,
        imageUrl: item.imageUrl,
        sortOrder: item.sortOrder,
        isActive: item.isActive
      }))
    });

    return created.id;
  });

  return getCaseById(saved, true);
};

export const setCaseActiveStatusByAdmin = async (caseId: string, isActive: boolean): Promise<CaseDetails> => {
  await prisma.case.update({
    where: { id: caseId },
    data: { isActive }
  });
  return getCaseById(caseId, true);
};

export const listCasesByAdmin = async (): Promise<CaseDetails[]> => {
  const rows = await prisma.case
    .findMany({
      orderBy: [{ createdAt: "desc" }],
      include: {
        items: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
        }
      }
    })
    .catch((error) => {
      if (isMissingCasesSchemaError(error)) {
        return [];
      }
      throw error;
    });
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    priceAtomic: row.priceAtomic,
    currency: row.currency,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items: row.items.map(asItemState)
  }));
};

const simulateDraw = (
  items: Array<{ id: string; name: string; valueAtomic: bigint; dropRate: Prisma.Decimal }>
): { payoutAtomic: bigint; topTier: boolean } => {
  const roll = Math.random();
  const threshold = computeTopTierThreshold(items);
  const dropped = pickCaseItem(
    items.map((item, idx) => ({
      id: item.id,
      name: item.name,
      valueAtomic: item.valueAtomic,
      dropRate: item.dropRate,
      imageUrl: null,
      sortOrder: idx,
      isActive: true
    })),
    roll
  );
  return {
    payoutAtomic: dropped.valueAtomic,
    topTier: dropped.valueAtomic >= threshold
  };
};

export const simulateCasesRtpByAdmin = async (rounds: number): Promise<CasesSimulationResult[]> => {
  const safeRounds = Math.max(1, Math.min(1_000_000, Math.trunc(rounds)));
  const rows = await prisma.case
    .findMany({
      where: {
        currency: PLATFORM_INTERNAL_CURRENCY
      },
      include: {
        items: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
        }
      },
      orderBy: [{ createdAt: "desc" }]
    })
    .catch((error) => {
      if (isMissingCasesSchemaError(error)) {
        return [];
      }
      throw error;
    });

  const results: CasesSimulationResult[] = [];
  for (const row of rows) {
    if (!row.items.length) {
      continue;
    }
    validateDropRates(row.items);
    let spentAtomic = 0n;
    let payoutAtomic = 0n;
    let hitTopTierCount = 0;
    for (let i = 0; i < safeRounds; i += 1) {
      spentAtomic += row.priceAtomic;
      const draw = simulateDraw(row.items);
      payoutAtomic += draw.payoutAtomic;
      if (draw.topTier) {
        hitTopTierCount += 1;
      }
    }
    const profitAtomic = spentAtomic - payoutAtomic;
    const rtpPercent = spentAtomic > 0n ? Number((payoutAtomic * 10000n) / spentAtomic) / 100 : 0;
    results.push({
      caseId: row.id,
      rounds: safeRounds,
      spentAtomic,
      payoutAtomic,
      profitAtomic,
      rtpPercent,
      hitTopTierCount
    });
  }
  return results;
};

export const listCasesByAdminSafe = listCasesByAdmin;
export const listCasesForAdmin = listCasesByAdmin;
export const updateCaseStatusByAdmin = setCaseActiveStatusByAdmin;
export const runCasesRtpSimulationByAdmin = simulateCasesRtpByAdmin;
