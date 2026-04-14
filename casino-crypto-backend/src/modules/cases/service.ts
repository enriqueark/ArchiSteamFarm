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
import { ensureUserAllowedFor } from "../users/access-guard";
import {
  MAX_GAME_BET_ATOMIC,
  PLATFORM_INTERNAL_CURRENCY,
  debitBalanceInTx
} from "../wallets/service";
import { RAIN_SNAPSHOT_SEED } from "./rain_snapshot_seed";

const RNG_BYTES = 6;
const RNG_MAX = 2 ** (RNG_BYTES * 8);
const RAIN_PROVIDER = "RAIN_GG";
const CASE_VOLATILITY_MIN = 0;
const CASE_VOLATILITY_MAX = 100;
const RAIN_FETCH_TIMEOUT_MS = 12_000;
const RAIN_FETCH_ATTEMPTS = 3;
const RAIN_MAX_CASES_PER_PAGE = 50;
const SKIN_WIKI_BASE_URL = "https://wiki.skin.club/en";
const CATALOG_IMAGE_BACKFILL_LIMIT = 150;
const SKIN_WIKI_IMAGE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SKIN_WIKI_IMAGE_CACHE_MAX = 5000;

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

export type Cs2SkinPreview = {
  id: string;
  name: string;
  valueAtomic: bigint;
  imageUrl: string | null;
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
  totalCatalogSkins: number;
  lowestSkinName: string | null;
  lowestSkinValueAtomic: string | null;
};

const FALLBACK_RAIN_SKIN_SEED = RAIN_SNAPSHOT_SEED;
const STATIC_SNAPSHOT_CHUNK_SIZE = 250;
const STATIC_SNAPSHOT_CASE_COUNT = new Set(
  FALLBACK_RAIN_SKIN_SEED.map((entry) => entry.sourceCaseSlug)
).size;

const importFallbackRainSkinSeed = async (actorUserId?: string | null): Promise<number> => {
  let inserted = 0;
  for (let offset = 0; offset < FALLBACK_RAIN_SKIN_SEED.length; offset += STATIC_SNAPSHOT_CHUNK_SIZE) {
    const chunk = FALLBACK_RAIN_SKIN_SEED.slice(offset, offset + STATIC_SNAPSHOT_CHUNK_SIZE).map((seed) => {
      const normalizedName = seed.name.trim();
      return {
        sourceProvider: RAIN_PROVIDER,
        sourceCaseSlug: seed.sourceCaseSlug,
        sourceSkinKey: normalizeSourceSkinKey(seed.sourceCaseSlug, normalizedName),
        name: normalizedName,
        valueAtomic: parseCoinsToAtomic(seed.valueCoins),
        imageUrl: seed.imageUrl || null,
        isActive: true,
        createdByUserId: actorUserId ?? null
      };
    });
    const result = await prisma.cs2SkinCatalog.createMany({
      data: chunk,
      skipDuplicates: true
    });
    inserted += result.count;
  }
  return inserted;
};

export const ensureCs2SkinCatalogPreloaded = async (actorUserId?: string | null): Promise<number> => {
  const beforeCount = await prisma.cs2SkinCatalog.count();
  if (beforeCount > 0) {
    return beforeCount;
  }
  await importFallbackRainSkinSeed(actorUserId);
  return prisma.cs2SkinCatalog.count();
};

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

const normalizeSkinSearchQuery = (name: string): string =>
  name
    .replace(/^stattrak™\s*/i, "")
    .replace(/^souvenir\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

const extractSkinClubImageCandidates = (markdown: string): string[] => {
  const urls = new Set<string>();
  const regex = /!\[[^\]]*]\((https?:\/\/(?:cfdn\.wiki\.skin\.club|cfdn\.skin\.club)\/[^)\s]+)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown))) {
    urls.add(match[1]);
  }
  return Array.from(urls);
};

const scoreSkinImageCandidate = (url: string): number => {
  let score = 0;
  if (url.includes("cfdn.wiki.skin.club")) {
    score += 3;
  }
  if (url.toLowerCase().includes("policy=skin-list")) {
    score += 2;
  }
  if (url.toLowerCase().includes("policy=skin-main")) {
    score += 1;
  }
  if (url.toLowerCase().includes(".png")) {
    score += 2;
  }
  if (url.toLowerCase().includes(".webp")) {
    score += 1;
  }
  return score;
};

const skinWikiImageCache = new Map<
  string,
  {
    url: string | null;
    expiresAt: number;
  }
>();
const skinWikiInFlightRequests = new Map<string, Promise<string | null>>();

const trimSkinWikiImageCacheIfNeeded = (): void => {
  if (skinWikiImageCache.size <= SKIN_WIKI_IMAGE_CACHE_MAX) {
    return;
  }
  const overflow = skinWikiImageCache.size - SKIN_WIKI_IMAGE_CACHE_MAX;
  let removed = 0;
  for (const key of skinWikiImageCache.keys()) {
    skinWikiImageCache.delete(key);
    removed += 1;
    if (removed >= overflow) {
      break;
    }
  }
};

const getCachedSkinWikiImage = (cacheKey: string): string | null | undefined => {
  const cached = skinWikiImageCache.get(cacheKey);
  if (!cached) {
    return undefined;
  }
  if (cached.expiresAt <= Date.now()) {
    skinWikiImageCache.delete(cacheKey);
    return undefined;
  }
  return cached.url;
};

const fetchSkinWikiImageUrlByName = async (name: string): Promise<string | null> => {
  const query = normalizeSkinSearchQuery(name);
  if (!query) {
    return null;
  }
  const cacheKey = query.toLowerCase();
  const cached = getCachedSkinWikiImage(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const inFlight = skinWikiInFlightRequests.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }
  const request = (async () => {
    try {
      const markdown = await fetchMarkdownViaJina(
        `${SKIN_WIKI_BASE_URL}/search?search=${encodeURIComponent(query)}`
      );
      const candidates = extractSkinClubImageCandidates(markdown);
      if (!candidates.length) {
        return null;
      }
      candidates.sort((a, b) => scoreSkinImageCandidate(b) - scoreSkinImageCandidate(a));
      return candidates[0];
    } catch {
      return null;
    }
  })();
  skinWikiInFlightRequests.set(cacheKey, request);
  try {
    const resolved = await request;
    skinWikiImageCache.set(cacheKey, {
      url: resolved,
      expiresAt: Date.now() + SKIN_WIKI_IMAGE_CACHE_TTL_MS
    });
    trimSkinWikiImageCacheIfNeeded();
    return resolved;
  } finally {
    skinWikiInFlightRequests.delete(cacheKey);
  }
};

const backfillMissingCatalogImageUrlsFromWiki = async (limit = CATALOG_IMAGE_BACKFILL_LIMIT): Promise<number> => {
  const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
  const rows = await prisma.cs2SkinCatalog.findMany({
    where: {
      OR: [{ imageUrl: null }, { imageUrl: "" }]
    },
    orderBy: [{ updatedAt: "asc" }],
    take: safeLimit,
    select: {
      id: true,
      name: true
    }
  });
  let updated = 0;
  for (const row of rows) {
    const wikiImageUrl = await fetchSkinWikiImageUrlByName(row.name);
    const nextImageUrl = wikiImageUrl ?? buildFallbackImageUrlFromName(row.name);
    if (!nextImageUrl) {
      continue;
    }
    await prisma.cs2SkinCatalog.update({
      where: { id: row.id },
      data: {
        imageUrl: nextImageUrl
      }
    });
    updated += 1;
    await sleep(35);
  }
  return updated;
};


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
    fallbackSeedUsed: false,
    totalCatalogSkins: 0,
    lowestSkinName: null,
    lowestSkinValueAtomic: null
  };
};

export const importRainCasesIntoSkinCatalogByAdmin = async (
  actorUserId: string,
  maxPages = 6,
  caseLimit = 20
): Promise<RainCatalogImportSummary> => {
  const safePages = Math.max(1, Math.min(20, Math.trunc(maxPages)));
  const safeCaseLimit = Math.max(1, Math.min(RAIN_MAX_CASES_PER_PAGE, Math.trunc(caseLimit)));
  const summary: RainCatalogImportSummary = {
    pagesScanned: 0,
    casesFound: STATIC_SNAPSHOT_CASE_COUNT,
    casesParsed: STATIC_SNAPSHOT_CASE_COUNT,
    skinsUpserted: 0,
    itemsParsed: 0,
    failedCases: 0,
    failureSamples: [],
    fallbackSeedUsed: true,
    totalCatalogSkins: 0,
    lowestSkinName: null,
    lowestSkinValueAtomic: null
  };
  const beforeCount = await prisma.cs2SkinCatalog.count();
  if (beforeCount === 0) {
    const inserted = await importFallbackRainSkinSeed(actorUserId);
    summary.skinsUpserted = inserted;
    summary.itemsParsed = inserted;
  }
  summary.totalCatalogSkins = await prisma.cs2SkinCatalog.count();
  if (summary.totalCatalogSkins <= 0) {
    summary.failedCases = Math.max(1, safePages * safeCaseLimit);
    summary.failureSamples.push("Catalog preload failed: no skins were persisted.");
  } else if (beforeCount > 0) {
    summary.failureSamples.push(
      `Catalog already preloaded (${summary.totalCatalogSkins} skins). Existing catalog preserved.`
    );
  } else {
    summary.failureSamples.push(`Catalog preloaded successfully (${summary.totalCatalogSkins} skins).`);
  }
  const backfilled = await backfillMissingCatalogImageUrlsFromWiki(CATALOG_IMAGE_BACKFILL_LIMIT);
  if (backfilled > 0) {
    summary.failureSamples.push(`Backfilled ${backfilled} skin image URLs from wiki.skin.club.`);
  }
  summary.failureSamples.push(
    `Live Rain sync disabled for stability. Request params ignored: pages=${safePages}, caseLimit=${safeCaseLimit}.`
  );
  const lowestSkin = await prisma.cs2SkinCatalog.findFirst({
    orderBy: [{ valueAtomic: "asc" }, { name: "asc" }],
    select: {
      name: true,
      valueAtomic: true
    }
  });
  summary.lowestSkinName = lowestSkin?.name ?? null;
  summary.lowestSkinValueAtomic = lowestSkin ? lowestSkin.valueAtomic.toString() : null;
  return summary;
};

export const listCs2SkinCatalogByAdmin = async (input: {
  q?: string;
  limit?: number;
  sourceCaseSlug?: string;
  actorUserId?: string;
}): Promise<Cs2SkinCatalogItem[]> => {
  const limit = Math.max(1, Math.min(5000, Math.trunc(input.limit ?? 5000)));
  await ensureCs2SkinCatalogPreloaded(input.actorUserId ?? null);
  const q = input.q?.trim();
  const where = {
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    ...(input.sourceCaseSlug ? { sourceCaseSlug: input.sourceCaseSlug } : {})
  };

  let rows = await prisma.cs2SkinCatalog.findMany({
    where,
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

export const deleteCs2SkinCatalogByPriceRangeByAdmin = async (input: {
  minValueAtomic?: bigint;
  maxValueAtomic?: bigint;
  q?: string;
  sourceCaseSlug?: string;
  onlyUnused?: boolean;
  dryRun?: boolean;
  actorUserId?: string;
}): Promise<{
  minValueAtomic: bigint | null;
  maxValueAtomic: bigint | null;
  matchedCount: number;
  deletedCount: number;
  skippedLinkedCount: number;
  remainingCatalogCount: number;
}> => {
  await ensureCs2SkinCatalogPreloaded(input.actorUserId ?? null);
  const q = input.q?.trim();
  const where: Prisma.Cs2SkinCatalogWhereInput = {
    ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    ...(input.sourceCaseSlug ? { sourceCaseSlug: input.sourceCaseSlug } : {}),
    ...(input.minValueAtomic !== undefined || input.maxValueAtomic !== undefined
      ? {
          valueAtomic: {
            ...(input.minValueAtomic !== undefined ? { gte: input.minValueAtomic } : {}),
            ...(input.maxValueAtomic !== undefined ? { lte: input.maxValueAtomic } : {})
          }
        }
      : {})
  };

  const matchedCount = await prisma.cs2SkinCatalog.count({ where });
  const currentCatalogCount = await prisma.cs2SkinCatalog.count();
  if (matchedCount <= 0) {
    return {
      minValueAtomic: input.minValueAtomic ?? null,
      maxValueAtomic: input.maxValueAtomic ?? null,
      matchedCount: 0,
      deletedCount: 0,
      skippedLinkedCount: 0,
      remainingCatalogCount: currentCatalogCount
    };
  }

  const onlyUnused = input.onlyUnused !== false;
  const dryRun = input.dryRun === true;
  if (!onlyUnused) {
    if (dryRun) {
      return {
        minValueAtomic: input.minValueAtomic ?? null,
        maxValueAtomic: input.maxValueAtomic ?? null,
        matchedCount,
        deletedCount: matchedCount,
        skippedLinkedCount: 0,
        remainingCatalogCount: Math.max(0, currentCatalogCount - matchedCount)
      };
    }
    const deleted = await prisma.cs2SkinCatalog.deleteMany({ where });
    return {
      minValueAtomic: input.minValueAtomic ?? null,
      maxValueAtomic: input.maxValueAtomic ?? null,
      matchedCount,
      deletedCount: deleted.count,
      skippedLinkedCount: 0,
      remainingCatalogCount: await prisma.cs2SkinCatalog.count()
    };
  }

  const matchedRows = await prisma.cs2SkinCatalog.findMany({
    where,
    select: { id: true }
  });
  const matchedIds = matchedRows.map((row) => row.id);
  if (!matchedIds.length) {
    return {
      minValueAtomic: input.minValueAtomic ?? null,
      maxValueAtomic: input.maxValueAtomic ?? null,
      matchedCount: 0,
      deletedCount: 0,
      skippedLinkedCount: 0,
      remainingCatalogCount: currentCatalogCount
    };
  }

  const usedInCases = await prisma.caseItem.findMany({
    where: {
      cs2SkinId: { in: matchedIds }
    },
    select: {
      cs2SkinId: true
    },
    distinct: ["cs2SkinId"]
  });
  const usedIds = new Set(
    usedInCases.map((row) => row.cs2SkinId).filter((value): value is string => typeof value === "string")
  );
  const deletableIds = matchedIds.filter((id) => !usedIds.has(id));

  if (!deletableIds.length) {
    return {
      minValueAtomic: input.minValueAtomic ?? null,
      maxValueAtomic: input.maxValueAtomic ?? null,
      matchedCount,
      deletedCount: 0,
      skippedLinkedCount: matchedIds.length,
      remainingCatalogCount: currentCatalogCount
    };
  }

  if (dryRun) {
    return {
      minValueAtomic: input.minValueAtomic ?? null,
      maxValueAtomic: input.maxValueAtomic ?? null,
      matchedCount,
      deletedCount: deletableIds.length,
      skippedLinkedCount: matchedIds.length - deletableIds.length,
      remainingCatalogCount: Math.max(0, currentCatalogCount - deletableIds.length)
    };
  }

  const deleted = await prisma.cs2SkinCatalog.deleteMany({
    where: {
      id: { in: deletableIds }
    }
  });

  return {
    minValueAtomic: input.minValueAtomic ?? null,
    maxValueAtomic: input.maxValueAtomic ?? null,
    matchedCount,
    deletedCount: deleted.count,
    skippedLinkedCount: matchedIds.length - deletableIds.length,
    remainingCatalogCount: await prisma.cs2SkinCatalog.count()
  };
};

export const findClosestCatalogSkinByValueAtomic = async (input: {
  valueAtomic: bigint;
  actorUserId?: string | null;
}): Promise<Cs2SkinPreview | null> => {
  if (input.valueAtomic <= 0n) {
    return null;
  }
  await ensureCs2SkinCatalogPreloaded(input.actorUserId ?? null);
  const [high, low] = await Promise.all([
    prisma.cs2SkinCatalog.findFirst({
      where: {
        valueAtomic: {
          gte: input.valueAtomic
        },
        isActive: true
      },
      orderBy: [{ valueAtomic: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        valueAtomic: true,
        imageUrl: true
      }
    }),
    prisma.cs2SkinCatalog.findFirst({
      where: {
        valueAtomic: {
          lte: input.valueAtomic
        },
        isActive: true
      },
      orderBy: [{ valueAtomic: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        valueAtomic: true,
        imageUrl: true
      }
    })
  ]);
  const pick = (() => {
    if (high && low) {
      const highDelta = high.valueAtomic - input.valueAtomic;
      const lowDelta = input.valueAtomic - low.valueAtomic;
      return highDelta <= lowDelta ? high : low;
    }
    return high ?? low ?? null;
  })();
  if (!pick) {
    return null;
  }
  return {
    id: pick.id,
    name: pick.name,
    valueAtomic: pick.valueAtomic,
    imageUrl: pick.imageUrl || buildFallbackImageUrlFromName(pick.name)
  };
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
  imageUrl: item.imageUrl ?? buildFallbackImageUrlFromName(item.name),
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
  const listCasesLegacyFallback = async (): Promise<CaseListItem[]> => {
    try {
      const rows = await prisma.$queryRaw<
        Array<{
          id: string;
          slug: string;
          title: string;
          description: string | null;
          priceAtomic: bigint;
          currency: Currency;
          isActive: boolean;
          createdAt: Date;
          updatedAt: Date;
          itemCount: bigint;
        }>
      >`
        SELECT
          c.id,
          c.slug,
          c.title,
          c.description,
          c."priceAtomic" AS "priceAtomic",
          c.currency,
          c."isActive" AS "isActive",
          c."createdAt" AS "createdAt",
          c."updatedAt" AS "updatedAt",
          COALESCE(ci."itemCount", 0)::bigint AS "itemCount"
        FROM "cases" c
        LEFT JOIN (
          SELECT "caseId", COUNT(*) AS "itemCount"
          FROM "case_items"
          WHERE "isActive" = true
          GROUP BY "caseId"
        ) ci ON ci."caseId" = c.id
        WHERE c."isActive" = true
          AND c.currency = ${PLATFORM_INTERNAL_CURRENCY}
        ORDER BY c."createdAt" DESC
      `;

      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        logoUrl: null,
        priceAtomic: row.priceAtomic,
        currency: row.currency,
        isActive: row.isActive,
        volatilityIndex: 0,
        volatilityTier: "L" as const,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        itemCount: Number(row.itemCount)
      }));
    } catch (error) {
      if (isMissingCasesSchemaError(error)) {
        return [];
      }
      throw error;
    }
  };

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
    .catch(async (error) => {
      if (isMissingCasesSchemaError(error)) {
        return null;
      }
      throw error;
    });
  if (!rows) {
    return listCasesLegacyFallback();
  }
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
  await ensureUserAllowedFor(input.userId, "WAGER");
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
  const catalogSkinById = new Map<string, { id: string; imageUrl: string | null; name: string }>();
  if (referencedSkinIds.length) {
    const existing = await prisma.cs2SkinCatalog.findMany({
      where: { id: { in: referencedSkinIds } },
      select: {
        id: true,
        imageUrl: true,
        name: true
      }
    });
    if (existing.length !== referencedSkinIds.length) {
      throw new AppError("One or more selected CS2 skins do not exist", 400, "CS2_SKIN_NOT_FOUND");
    }
    for (const row of existing) {
      catalogSkinById.set(row.id, {
        id: row.id,
        imageUrl: row.imageUrl ?? null,
        name: row.name
      });
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
    const linkedSkin = item.cs2SkinId ? catalogSkinById.get(item.cs2SkinId) : undefined;
    const resolvedImageUrl =
      item.imageUrl?.trim() ||
      linkedSkin?.imageUrl ||
      (linkedSkin?.name ? buildFallbackImageUrlFromName(linkedSkin.name) : null);
    return {
      name: item.name.trim(),
      valueAtomic: item.valueAtomic,
      dropRate: parsedDrop,
      imageUrl: resolvedImageUrl ?? null,
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

      // Keep historical case items referenced by past openings to avoid FK errors on edit.
      await tx.caseItem.updateMany({
        where: {
          caseId: updatedCase.id,
          isActive: true
        },
        data: {
          isActive: false
        }
      });
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

  return getCaseById(saved, false);
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
          where: { isActive: true },
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
    volatilityIndex: caseVolatilityIndexFromItems(row.items),
    volatilityTier: getVolatilityTier(caseVolatilityIndexFromItems(row.items)),
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
