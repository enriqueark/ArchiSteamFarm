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
const RAIN_PROVIDER = "RAIN_GG";
const CASE_VOLATILITY_MIN = 0;
const CASE_VOLATILITY_MAX = 100;
const RAIN_FETCH_TIMEOUT_MS = 12_000;
const RAIN_FETCH_ATTEMPTS = 3;
const RAIN_MAX_CASES_PER_PAGE = 50;

export type VolatilityTier = "L" | "M" | "H" | "I";

export type Cs2SkinCatalogItem = {
  id: string;
  sourceProvider: string;
  sourceCaseSlug: string | null;
  sourceSkinKey: string;
  name: string;
  valueAtomic: bigint;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type RainCaseCard = {
  slug: string;
};

type RainCaseItemParsed = {
  sourceCaseSlug: string;
  sourceSkinKey: string;
  name: string;
  valueAtomic: bigint;
  dropRate: string;
  imageUrl: string | null;
};

export type RainCatalogImportSummary = {
  pagesScanned: number;
  casesFound: number;
  casesParsed: number;
  skinsUpserted: number;
  itemsParsed: number;
  failedCases: number;
  failureSamples: string[];
  fallbackSeedUsed: boolean;
};

const FALLBACK_RAIN_SKIN_SEED: Array<{
  sourceCaseSlug: string;
  name: string;
  valueCoins: string;
  imageUrl: string;
}> = [
  {
    sourceCaseSlug: "island-life",
    name: "M9 Bayonet | StatTrak Lore",
    valueCoins: "752.45",
    imageUrl: "https://cdn.rain.gg/images/items/stattrak-m9-bayonet-lore-field-tested.png"
  },
  {
    sourceCaseSlug: "island-life",
    name: "AK-47 | StatTrak Bloodsport",
    valueCoins: "666.78",
    imageUrl: "https://cdn.rain.gg/images/items/stattrak-ak-47-bloodsport-well-worn.png"
  },
  {
    sourceCaseSlug: "island-life",
    name: "M4A4 | Cyber Security",
    valueCoins: "433.20",
    imageUrl: "https://cdn.rain.gg/images/items/m4a4-cyber-security-factory-new.png"
  },
  {
    sourceCaseSlug: "island-life",
    name: "Paracord Knife | StatTrak Slaughter",
    valueCoins: "355.61",
    imageUrl: "https://cdn.rain.gg/images/items/stattrak-paracord-knife-slaughter-factory-new.png"
  },
  {
    sourceCaseSlug: "island-life",
    name: "Hand Wraps | Duct Tape",
    valueCoins: "191.95",
    imageUrl: "https://cdn.rain.gg/images/items/hand-wraps-duct-tape-minimal-wear.png"
  },
  {
    sourceCaseSlug: "island-life",
    name: "Desert Eagle | Code Red",
    valueCoins: "103.95",
    imageUrl: "https://cdn.rain.gg/images/items/desert-eagle-code-red-minimal-wear.png"
  },
  {
    sourceCaseSlug: "raven",
    name: "AK-47 | Cartel",
    valueCoins: "10.70",
    imageUrl: "https://cdn.rain.gg/images/items/stattrak-ak-47-cartel-field-tested.png"
  },
  {
    sourceCaseSlug: "otherworldly",
    name: "Butterfly Knife | Doppler Black Pearl",
    valueCoins: "2404.89",
    imageUrl: "https://cdn.rain.gg/images/items/butterfly-knife-doppler-factory-new-black-pearl.png"
  },
  {
    sourceCaseSlug: "container",
    name: "Karambit | Doppler Phase 4",
    valueCoins: "46.41",
    imageUrl: "https://cdn.rain.gg/images/items/stattrak-karambit-doppler-factory-new-phase-4.png"
  },
  {
    sourceCaseSlug: "knapsack",
    name: "M4A1-S | Welcome to the Jungle",
    valueCoins: "50.01",
    imageUrl: "https://cdn.rain.gg/images/items/souvenir-m4a1-s-welcome-to-the-jungle-factory-new.png"
  },
  {
    sourceCaseSlug: "asylum",
    name: "AWP | Gungnir",
    valueCoins: "401.06",
    imageUrl: "https://cdn.rain.gg/images/items/awp-gungnir-minimal-wear.png"
  },
  {
    sourceCaseSlug: "zipped",
    name: "AWP | Dragon Lore",
    valueCoins: "276.59",
    imageUrl: "https://cdn.rain.gg/images/items/awp-dragon-lore-minimal-wear.png"
  },
  {
    sourceCaseSlug: "iceberg",
    name: "Karambit | Doppler Sapphire",
    valueCoins: "41.07",
    imageUrl: "https://cdn.rain.gg/images/items/karambit-doppler-factory-new-sapphire.png"
  },
  {
    sourceCaseSlug: "reflection",
    name: "AWP | Medusa",
    valueCoins: "48.55",
    imageUrl: "https://cdn.rain.gg/images/items/awp-medusa-factory-new.png"
  },
  {
    sourceCaseSlug: "fountain",
    name: "M9 Bayonet | Doppler Sapphire",
    valueCoins: "63.74",
    imageUrl: "https://cdn.rain.gg/images/items/stattrak-m9-bayonet-doppler-minimal-wear-sapphire.png"
  },
  {
    sourceCaseSlug: "freezer",
    name: "AWP | The Prince",
    valueCoins: "70.58",
    imageUrl: "https://cdn.rain.gg/images/items/awp-the-prince-minimal-wear.png"
  },
  {
    sourceCaseSlug: "breaker-box",
    name: "Butterfly Knife | Lore",
    valueCoins: "39.47",
    imageUrl: "https://cdn.rain.gg/images/items/butterfly-knife-lore-factory-new.png"
  },
  {
    sourceCaseSlug: "operation-wildfire",
    name: "Bowie Knife | Case Hardened",
    valueCoins: "7.37",
    imageUrl: "https://cdn.rain.gg/images/items/stattrak-bowie-knife-case-hardened-factory-new.png"
  },
  {
    sourceCaseSlug: "falchion",
    name: "Falchion Knife | Crimson Web",
    valueCoins: "4.50",
    imageUrl: "https://cdn.rain.gg/images/items/falchion-knife-crimson-web-factory-new.png"
  },
  {
    sourceCaseSlug: "fracture",
    name: "Skeleton Knife | Fade",
    valueCoins: "5.42",
    imageUrl: "https://cdn.rain.gg/images/items/skeleton-knife-fade-factory-new.png"
  }
];

const parseCoinsToAtomic = (value: string): bigint => {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new AppError(`Invalid coins amount: ${value}`, 400, "INVALID_COINS_AMOUNT");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const fracPadded = (fraction + "00000000").slice(0, 8);
  return BigInt(whole) * 100000000n + BigInt(fracPadded);
};

const clampVolatility = (value: number): number =>
  Math.max(CASE_VOLATILITY_MIN, Math.min(CASE_VOLATILITY_MAX, Math.round(value)));

const caseVolatilityIndexFromItems = (
  items: Array<{ valueAtomic: bigint; dropRate: Prisma.Decimal }>
): number => {
  if (!items.length) {
    return 0;
  }
  const probabilities = items.map((item) => Number(item.dropRate.toString()) / 100);
  const values = items.map((item) => Number(item.valueAtomic) / 1e8);
  const expected = values.reduce((acc, value, idx) => acc + value * probabilities[idx], 0);
  if (!Number.isFinite(expected) || expected <= 0) {
    return 0;
  }
  const variance = values.reduce((acc, value, idx) => {
    const delta = value - expected;
    return acc + probabilities[idx] * delta * delta;
  }, 0);
  const stdDev = Math.sqrt(Math.max(variance, 0));
  const coefficientVariation = stdDev / expected;
  return clampVolatility(coefficientVariation * 28);
};

const getVolatilityTier = (index: number): VolatilityTier => {
  if (index < 25) {
    return "L";
  }
  if (index < 50) {
    return "M";
  }
  if (index < 75) {
    return "H";
  }
  return "I";
};

const normalizeSkinLabel = (weapon: string, skin: string): string => {
  const left = weapon.trim();
  const right = skin.trim();
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return `${left} | ${right}`;
};

const normalizeSourceSkinKey = (sourceCaseSlug: string, name: string): string =>
  `${sourceCaseSlug}:${name.toLowerCase().replace(/\s+/g, " ").trim()}`;

const buildFallbackImageUrlFromName = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/\|/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `https://cdn.csgoskins.gg/public/icons/${slug}.png`;
};

const buildJinaMirrorUrl = (url: string): string => `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;


const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const fetchMarkdownViaJina = async (url: string): Promise<string> => {
  let lastStatus = 0;
  let lastError = "";
  for (let attempt = 1; attempt <= RAIN_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RAIN_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(buildJinaMirrorUrl(url), {
        signal: controller.signal,
        headers: {
          Accept: "text/plain"
        }
      });
      clearTimeout(timeout);
      lastStatus = response.status;
      if (response.ok) {
        return response.text();
      }
      if (response.status === 429 || response.status >= 500) {
        await sleep(250 * attempt);
        continue;
      }
      break;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(250 * attempt);
    }
  }
  throw new AppError(
    `Unable to fetch source page${lastStatus ? ` (${lastStatus})` : lastError ? ` (${lastError})` : ""}`,
    502,
    "RAIN_FETCH_FAILED"
  );
};

const extractRainCaseLinksFromIndex = (markdown: string): RainCaseCard[] => {
  const regex = /\]\(https?:\/\/rain\.gg\/games\/case-opening\/([a-z0-9-]+)\)/g;
  const slugs = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown))) {
    slugs.add(match[1]);
  }
  return Array.from(slugs).map((slug) => ({ slug }));
};

const parseRainCaseItemsFromMarkdown = (caseSlug: string, markdown: string): RainCaseItemParsed[] => {
  const lines = markdown.split("\n").map((line) => line.trim());
  const startIndex = lines.findIndex((line) => line.toLowerCase() === "## case contains");
  if (startIndex < 0) {
    return [];
  }

  const parsed: RainCaseItemParsed[] = [];
  let idx = startIndex + 1;
  while (idx < lines.length) {
    const dropLine = lines[idx];
    if (!dropLine) {
      idx += 1;
      continue;
    }
    if (dropLine.startsWith("## ")) {
      break;
    }
    if (!/^\d+(\.\d+)?%$/.test(dropLine)) {
      idx += 1;
      continue;
    }

    const dropRate = dropLine.replace("%", "");
    const imageLine = lines[idx + 1] ?? "";
    const weaponLine = lines[idx + 2] ?? "";
    const skinLine = lines[idx + 3] ?? "";
    const valueLine = lines[idx + 4] ?? "";

    if (!/^\d[\d,]*(\.\d+)?$/.test(valueLine)) {
      idx += 1;
      continue;
    }

    const imageUrlMatch = imageLine.match(/\((https?:\/\/[^)]+)\)/i);
    const name = normalizeSkinLabel(weaponLine, skinLine);
    const sourceSkinKey = normalizeSourceSkinKey(caseSlug, name);
    const imageUrl = imageUrlMatch ? imageUrlMatch[1] : buildFallbackImageUrlFromName(name);
    parsed.push({
      sourceCaseSlug: caseSlug,
      sourceSkinKey,
      name,
      valueAtomic: parseCoinsToAtomic(valueLine),
      dropRate,
      imageUrl
    });

    idx += 5;
  }

  return parsed;
};

export const importRainCatalogPageByAdmin = async (
  actorUserId: string,
  page: number,
  caseLimit = 20
): Promise<RainCatalogImportSummary> => {
  const safePage = Math.max(0, Math.min(20, Math.trunc(page)));
  const safeCaseLimit = Math.max(1, Math.min(RAIN_MAX_CASES_PER_PAGE, Math.trunc(caseLimit)));
  const indexUrl =
    safePage > 0
      ? `https://rain.gg/games/case-opening?page=${safePage}`
      : "https://rain.gg/games/case-opening";
  const indexMarkdown = await fetchMarkdownViaJina(indexUrl);
  const cases = extractRainCaseLinksFromIndex(indexMarkdown).slice(0, safeCaseLimit);

  let casesParsed = 0;
  let itemsParsed = 0;
  let skinsUpserted = 0;
  let failedCases = 0;
  const failureSamples: string[] = [];

  for (const rainCase of cases) {
    try {
      const caseMarkdown = await fetchMarkdownViaJina(
        `https://rain.gg/games/case-opening/${encodeURIComponent(rainCase.slug)}`
      );
      const items = parseRainCaseItemsFromMarkdown(rainCase.slug, caseMarkdown);
      if (!items.length) {
        continue;
      }
      casesParsed += 1;
      itemsParsed += items.length;
      for (const item of items) {
        await prisma.cs2SkinCatalog.upsert({
          where: {
            sourceProvider_sourceSkinKey: {
              sourceProvider: RAIN_PROVIDER,
              sourceSkinKey: item.sourceSkinKey
            }
          },
          create: {
            sourceProvider: RAIN_PROVIDER,
            sourceCaseSlug: item.sourceCaseSlug,
            sourceSkinKey: item.sourceSkinKey,
            name: item.name,
            valueAtomic: item.valueAtomic,
            imageUrl: item.imageUrl,
            isActive: true,
            createdByUserId: actorUserId
          },
          update: {
            sourceCaseSlug: item.sourceCaseSlug,
            name: item.name,
            valueAtomic: item.valueAtomic,
            imageUrl: item.imageUrl,
            isActive: true
          }
        });
        skinsUpserted += 1;
      }
    } catch (error) {
      failedCases += 1;
      if (failureSamples.length < 5) {
        const message = error instanceof Error ? error.message : "Unknown error";
        failureSamples.push(`${rainCase.slug}: ${message}`);
      }
    } finally {
      // Small pause to reduce provider rate-limits on burst imports.
      await sleep(80);
    }
  }

  return {
    pagesScanned: 1,
    casesFound: cases.length,
    casesParsed,
    skinsUpserted,
    itemsParsed,
    failedCases,
    failureSamples,
    fallbackSeedUsed: false
  };
};

export const importRainCasesIntoSkinCatalogByAdmin = async (
  actorUserId: string,
  maxPages = 6,
  caseLimit = 20
): Promise<RainCatalogImportSummary> => {
  const safePages = Math.max(1, Math.min(20, Math.trunc(maxPages)));
  const summary: RainCatalogImportSummary = {
    pagesScanned: 0,
    casesFound: 0,
    casesParsed: 0,
    skinsUpserted: 0,
    itemsParsed: 0,
    failedCases: 0,
    failureSamples: [],
    fallbackSeedUsed: false
  };
  for (let page = 0; page < safePages; page += 1) {
    const pageSummary = await importRainCatalogPageByAdmin(actorUserId, page, caseLimit);
    summary.pagesScanned += pageSummary.pagesScanned;
    summary.casesFound += pageSummary.casesFound;
    summary.casesParsed += pageSummary.casesParsed;
    summary.skinsUpserted += pageSummary.skinsUpserted;
    summary.itemsParsed += pageSummary.itemsParsed;
    summary.failedCases += pageSummary.failedCases;
    if (summary.failureSamples.length < 8 && pageSummary.failureSamples.length) {
      for (const sample of pageSummary.failureSamples) {
        if (summary.failureSamples.length >= 8) {
          break;
        }
        summary.failureSamples.push(sample);
      }
    }
  }
  const importedAnything = summary.skinsUpserted > 0;
  if (!importedAnything) {
    for (const seed of FALLBACK_RAIN_SKIN_SEED) {
      const normalizedName = seed.name.trim();
      const sourceSkinKey = normalizeSourceSkinKey(seed.sourceCaseSlug, normalizedName);
      await prisma.cs2SkinCatalog.upsert({
        where: {
          sourceProvider_sourceSkinKey: {
            sourceProvider: RAIN_PROVIDER,
            sourceSkinKey
          }
        },
        create: {
          sourceProvider: RAIN_PROVIDER,
          sourceCaseSlug: seed.sourceCaseSlug,
          sourceSkinKey,
          name: normalizedName,
          valueAtomic: parseCoinsToAtomic(seed.valueCoins),
          imageUrl: seed.imageUrl,
          isActive: true,
          createdByUserId: actorUserId
        },
        update: {
          sourceCaseSlug: seed.sourceCaseSlug,
          name: normalizedName,
          valueAtomic: parseCoinsToAtomic(seed.valueCoins),
          imageUrl: seed.imageUrl,
          isActive: true
        }
      });
    }
    summary.skinsUpserted = FALLBACK_RAIN_SKIN_SEED.length;
    summary.itemsParsed = FALLBACK_RAIN_SKIN_SEED.length;
    summary.fallbackSeedUsed = true;
    if (summary.failureSamples.length < 8) {
      summary.failureSamples.push(
        "Rain catalog unavailable right now, fallback CS2 seed imported so admin can continue."
      );
    }
  }
  return summary;
};

export const listCs2SkinCatalogByAdmin = async (input: {
  q?: string;
  limit?: number;
  sourceCaseSlug?: string;
}): Promise<Cs2SkinCatalogItem[]> => {
  const limit = Math.max(1, Math.min(500, Math.trunc(input.limit ?? 100)));
  const q = input.q?.trim();
  const rows = await prisma.cs2SkinCatalog.findMany({
    where: {
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      ...(input.sourceCaseSlug ? { sourceCaseSlug: input.sourceCaseSlug } : {})
    },
    orderBy: [{ valueAtomic: "desc" }, { name: "asc" }],
    take: limit
  });
  return rows.map((row) => ({
    id: row.id,
    sourceProvider: row.sourceProvider,
    sourceCaseSlug: row.sourceCaseSlug,
    sourceSkinKey: row.sourceSkinKey,
    name: row.name,
    valueAtomic: row.valueAtomic,
    imageUrl: row.imageUrl,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
};

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
  logoUrl: string | null;
  priceAtomic: bigint;
  currency: Currency;
  isActive: boolean;
  volatilityIndex: number;
  volatilityTier: VolatilityTier;
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
  cs2SkinId: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type CaseDetails = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  logoUrl: string | null;
  priceAtomic: bigint;
  currency: Currency;
  isActive: boolean;
  volatilityIndex: number;
  volatilityTier: VolatilityTier;
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
  caseSlug: string;
  caseTitle: string;
  volatilityIndex: number;
  volatilityTier: VolatilityTier;
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
  logoUrl?: string | null;
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
    cs2SkinId?: string | null;
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
  cs2SkinId?: string | null;
  sortOrder: number;
  isActive: boolean;
}): CaseItemState => ({
  id: item.id,
  name: item.name,
  valueAtomic: item.valueAtomic,
  dropRate: item.dropRate.toFixed(8),
  imageUrl: item.imageUrl,
  cs2SkinId: item.cs2SkinId ?? null,
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
        items: {
          where: { isActive: true },
          select: {
            valueAtomic: true,
            dropRate: true
          }
        },
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
    logoUrl: row.logoUrl,
    priceAtomic: row.priceAtomic,
    currency: row.currency,
    isActive: row.isActive,
    volatilityIndex: caseVolatilityIndexFromItems(row.items),
    volatilityTier: getVolatilityTier(caseVolatilityIndexFromItems(row.items)),
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
    logoUrl: selected.logoUrl,
    priceAtomic: selected.priceAtomic,
    currency: selected.currency,
    isActive: selected.isActive,
    volatilityIndex: caseVolatilityIndexFromItems(selected.items.filter((item) => item.isActive)),
    volatilityTier: getVolatilityTier(
      caseVolatilityIndexFromItems(selected.items.filter((item) => item.isActive))
    ),
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

  const referencedSkinIds = Array.from(
    new Set(
      input.items
        .map((item) => item.cs2SkinId?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
  if (referencedSkinIds.length) {
    const existing = await prisma.cs2SkinCatalog.findMany({
      where: { id: { in: referencedSkinIds } },
      select: { id: true }
    });
    if (existing.length !== referencedSkinIds.length) {
      throw new AppError("One or more selected CS2 skins do not exist", 400, "CS2_SKIN_NOT_FOUND");
    }
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
      isActive: item.isActive ?? true,
      cs2SkinId: item.cs2SkinId ?? null
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
          logoUrl: input.logoUrl?.trim() || null,
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
          isActive: item.isActive,
          cs2SkinId: item.cs2SkinId
        }))
      });

      return updatedCase.id;
    }

    const created = await tx.case.create({
      data: {
        slug,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        logoUrl: input.logoUrl?.trim() || null,
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
        isActive: item.isActive,
        cs2SkinId: item.cs2SkinId
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
    logoUrl: row.logoUrl,
    priceAtomic: row.priceAtomic,
    currency: row.currency,
    isActive: row.isActive,
    volatilityIndex: caseVolatilityIndexFromItems(row.items.filter((item) => item.isActive)),
    volatilityTier: getVolatilityTier(
      caseVolatilityIndexFromItems(row.items.filter((item) => item.isActive))
    ),
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
    const volatilityIndex = caseVolatilityIndexFromItems(row.items);
    results.push({
      caseId: row.id,
      caseSlug: row.slug,
      caseTitle: row.title,
      volatilityIndex,
      volatilityTier: getVolatilityTier(volatilityIndex),
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

export const volatilityTierFromIndex = getVolatilityTier;
export const volatilityIndexFromCaseItems = caseVolatilityIndexFromItems;
