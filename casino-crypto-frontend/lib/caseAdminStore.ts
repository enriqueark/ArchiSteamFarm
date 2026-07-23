import type { CaseDetails, CaseItem, CaseListItem } from "@/lib/api";

export const CASE_ADMIN_STORAGE_KEY = "admin-cases:v1";

export const CASE_CATEGORY_TAGS = [
  "ALL",
  "ORIGINALS",
  "CS2",
  "KNIVES",
  "GLOVES",
  "1%",
  "5%",
  "10%",
  "CREATOR"
] as const;

export type CaseCategoryTag = (typeof CASE_CATEGORY_TAGS)[number];

export type CaseSortKey =
  | "NEWEST"
  | "PRICE_DESC"
  | "PRICE_ASC"
  | "VOLATILITY_DESC"
  | "VOLATILITY_ASC";

export type ManagedCaseSource = "backend" | "admin-local" | "admin-override";

export type CaseMarketplaceItem = CaseListItem & {
  tags: CaseCategoryTag[];
  source: ManagedCaseSource;
};

export type CaseMarketplaceDetails = CaseDetails & {
  tags: CaseCategoryTag[];
  source: ManagedCaseSource;
};

export type AdminCaseFormItem = {
  id: string;
  name: string;
  imageUrl: string;
  valueCoins: string;
  dropRate: string;
  sortOrder: number;
  isActive: boolean;
};

type StoredCaseItem = {
  id: string;
  name: string;
  imageUrl: string | null;
  valueAtomic: string;
  dropRate: string;
  sortOrder: number;
  isActive: boolean;
  cs2SkinId: string | null;
};

type StoredAdminCase = {
  id: string;
  remoteCaseId: string | null;
  slug: string;
  title: string;
  description: string | null;
  logoUrl: string | null;
  priceAtomic: string;
  currency: string;
  isActive: boolean;
  tags: CaseCategoryTag[];
  items: StoredCaseItem[];
  volatilityIndex: number;
  volatilityTier: "L" | "M" | "H" | "I";
  createdAt: string;
  updatedAt: string;
};

type AdminCasesStore = {
  version: 1;
  managedCases: StoredAdminCase[];
};

const emptyStore = (): AdminCasesStore => ({
  version: 1,
  managedCases: []
});

const toAtomicString = (coins: string | number): string => {
  const n = typeof coins === "number" ? coins : Number(coins);
  if (!Number.isFinite(n)) return "0";
  return String(Math.max(0, Math.round(n * 1e8)));
};

const fromAtomicString = (atomic: string): string => {
  const n = Number(atomic);
  if (!Number.isFinite(n)) return "0.00";
  return (n / 1e8).toFixed(2);
};

const normalizeTagSet = (tags: CaseCategoryTag[] | string[] | undefined): CaseCategoryTag[] => {
  const next = new Set<CaseCategoryTag>();
  for (const tag of tags || []) {
    const upper = String(tag || "").trim().toUpperCase() as CaseCategoryTag;
    if (CASE_CATEGORY_TAGS.includes(upper)) {
      next.add(upper);
    }
  }
  if (next.size === 0) {
    next.add("ALL");
  }
  return Array.from(next);
};

const deriveCaseTags = (title: string, description?: string | null): CaseCategoryTag[] => {
  const text = `${title} ${description || ""}`.toLowerCase();
  const tags: CaseCategoryTag[] = ["ALL"];
  if (text.includes("original")) tags.push("ORIGINALS");
  if (text.includes("cs2") || text.includes("counter-strike")) tags.push("CS2");
  if (text.includes("knife")) tags.push("KNIVES");
  if (text.includes("glove")) tags.push("GLOVES");
  if (text.includes("1%")) tags.push("1%");
  if (text.includes("5%")) tags.push("5%");
  if (text.includes("10%")) tags.push("10%");
  if (text.includes("creator") || text.includes("community")) tags.push("CREATOR");
  return normalizeTagSet(tags);
};

export const computeVolatilityFromItems = (
  items: Array<{ valueAtomic: string; dropRate: string; isActive?: boolean }>
): { volatilityIndex: number; volatilityTier: "L" | "M" | "H" | "I" } => {
  const valid = items
    .map((item) => ({
      value: Number(item.valueAtomic),
      rate: Number(item.dropRate),
      isActive: item.isActive !== false
    }))
    .filter(
      (item) =>
        item.isActive &&
        Number.isFinite(item.value) &&
        item.value > 0 &&
        Number.isFinite(item.rate) &&
        item.rate > 0
    );

  if (!valid.length) {
    return { volatilityIndex: 0, volatilityTier: "L" };
  }

  const rateTotal = valid.reduce((acc, item) => acc + item.rate, 0);
  const normalized = valid.map((item) => ({ value: item.value, p: item.rate / rateTotal }));
  const mean = normalized.reduce((acc, item) => acc + item.value * item.p, 0);
  const variance = normalized.reduce((acc, item) => acc + item.p * Math.pow(item.value - mean, 2), 0);
  const std = Math.sqrt(variance);
  const coefficient = mean <= 0 ? 0 : std / mean;

  const maxValue = normalized.reduce((max, item) => Math.max(max, item.value), 0);
  const maxValueProbability = normalized
    .filter((item) => item.value === maxValue)
    .reduce((acc, item) => acc + item.p, 0);
  const jackpotRatio = mean <= 0 ? 1 : maxValue / mean;
  const rarityFactor = 1 - Math.max(0, Math.min(1, maxValueProbability));

  const volatilityScore =
    coefficient * 70 +
    Math.max(0, jackpotRatio - 1) * 8 +
    rarityFactor * 22;
  const volatilityIndex = Math.max(0, Math.min(99, Math.round(volatilityScore)));

  const volatilityTier: "L" | "M" | "H" | "I" =
    volatilityIndex < 25 ? "L" : volatilityIndex < 50 ? "M" : volatilityIndex < 75 ? "H" : "I";

  return { volatilityIndex, volatilityTier };
};

const readStore = (): AdminCasesStore => {
  if (typeof window === "undefined") {
    return emptyStore();
  }
  const raw = window.localStorage.getItem(CASE_ADMIN_STORAGE_KEY);
  if (!raw) return emptyStore();
  try {
    const parsed = JSON.parse(raw) as AdminCasesStore;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.managedCases)) {
      return emptyStore();
    }
    return parsed;
  } catch {
    return emptyStore();
  }
};

const writeStore = (store: AdminCasesStore): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CASE_ADMIN_STORAGE_KEY, JSON.stringify(store));
};

const toStoredItems = (items: AdminCaseFormItem[]): StoredCaseItem[] =>
  items
    .map((item, idx) => ({
      id: item.id || `item-${idx + 1}`,
      name: item.name.trim(),
      imageUrl: item.imageUrl.trim() || null,
      valueAtomic: toAtomicString(item.valueCoins),
      dropRate: String(Math.max(0, Number(item.dropRate) || 0)),
      sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : idx,
      isActive: item.isActive !== false,
      cs2SkinId: null
    }))
    .filter((item) => item.name);

const toCaseItem = (item: StoredCaseItem): CaseItem => ({
  id: item.id,
  name: item.name,
  valueAtomic: item.valueAtomic,
  dropRate: item.dropRate,
  imageUrl: item.imageUrl,
  cs2SkinId: item.cs2SkinId,
  sortOrder: item.sortOrder,
  isActive: item.isActive
});

const toMarketplaceListItem = (entry: StoredAdminCase): CaseMarketplaceItem => ({
  id: entry.remoteCaseId ?? entry.id,
  slug: entry.slug,
  title: entry.title,
  description: entry.description,
  logoUrl: entry.logoUrl,
  priceAtomic: entry.priceAtomic,
  currency: entry.currency,
  isActive: entry.isActive,
  volatilityIndex: entry.volatilityIndex,
  volatilityTier: entry.volatilityTier,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
  itemCount: entry.items.length,
  tags: normalizeTagSet(entry.tags),
  source: entry.remoteCaseId ? "admin-override" : "admin-local"
});

const toMarketplaceDetails = (entry: StoredAdminCase): CaseMarketplaceDetails => ({
  id: entry.remoteCaseId ?? entry.id,
  slug: entry.slug,
  title: entry.title,
  description: entry.description,
  logoUrl: entry.logoUrl,
  priceAtomic: entry.priceAtomic,
  currency: entry.currency,
  isActive: entry.isActive,
  volatilityIndex: entry.volatilityIndex,
  volatilityTier: entry.volatilityTier,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
  items: entry.items.map(toCaseItem),
  tags: normalizeTagSet(entry.tags),
  source: entry.remoteCaseId ? "admin-override" : "admin-local"
});

export const getManagedAdminCases = (): CaseMarketplaceDetails[] => {
  const store = readStore();
  return store.managedCases.map(toMarketplaceDetails);
};

export const getManagedCaseForRemoteId = (remoteCaseId: string): CaseMarketplaceDetails | null => {
  const store = readStore();
  const match = store.managedCases.find((entry) => entry.remoteCaseId === remoteCaseId);
  return match ? toMarketplaceDetails(match) : null;
};

export const getManagedLocalCaseById = (caseId: string): CaseMarketplaceDetails | null => {
  const store = readStore();
  const match = store.managedCases.find((entry) => entry.remoteCaseId === null && entry.id === caseId);
  return match ? toMarketplaceDetails(match) : null;
};

export const upsertManagedCase = (input: {
  id?: string;
  remoteCaseId?: string | null;
  slug: string;
  title: string;
  description?: string | null;
  logoUrl?: string | null;
  priceCoins: string | number;
  isActive: boolean;
  tags: CaseCategoryTag[];
  items: AdminCaseFormItem[];
}): CaseMarketplaceDetails => {
  const store = readStore();
  const now = new Date().toISOString();
  const remoteCaseId = input.remoteCaseId ?? null;
  const storedItems = toStoredItems(input.items);
  const volatility = computeVolatilityFromItems(storedItems);
  const recordId = input.id ?? (remoteCaseId ? `override-${remoteCaseId}` : `local-${Date.now().toString(36)}`);
  const current = store.managedCases.find((entry) => entry.id === recordId || (remoteCaseId && entry.remoteCaseId === remoteCaseId));

  const next: StoredAdminCase = {
    id: current?.id ?? recordId,
    remoteCaseId,
    slug: input.slug.trim() || input.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title: input.title.trim() || "Untitled Case",
    description: input.description?.trim() || null,
    logoUrl: input.logoUrl?.trim() || null,
    priceAtomic: toAtomicString(input.priceCoins),
    currency: "COINS",
    isActive: input.isActive,
    tags: normalizeTagSet(input.tags),
    items: storedItems,
    volatilityIndex: volatility.volatilityIndex,
    volatilityTier: volatility.volatilityTier,
    createdAt: current?.createdAt ?? now,
    updatedAt: now
  };

  const filtered = store.managedCases.filter((entry) =>
    remoteCaseId ? entry.remoteCaseId !== remoteCaseId : entry.id !== next.id
  );
  filtered.push(next);
  writeStore({
    version: 1,
    managedCases: filtered
  });
  return toMarketplaceDetails(next);
};

export const removeManagedCase = (id: string): void => {
  const store = readStore();
  const next = store.managedCases.filter((entry) => entry.id !== id);
  writeStore({
    version: 1,
    managedCases: next
  });
};

export const applyManagedCasesToList = (
  remoteCases: CaseListItem[],
  options?: { includeInvisible?: boolean }
): CaseMarketplaceItem[] => {
  const includeInvisible = options?.includeInvisible === true;
  const store = readStore();
  const overridesByRemoteId = new Map(store.managedCases.filter((entry) => entry.remoteCaseId).map((entry) => [entry.remoteCaseId as string, entry]));
  const localCases = store.managedCases.filter((entry) => !entry.remoteCaseId);

  const mergedRemote = remoteCases
    .map((remoteCase): CaseMarketplaceItem => {
      const override = overridesByRemoteId.get(remoteCase.id);
      if (!override) {
        return {
          ...remoteCase,
          tags: deriveCaseTags(remoteCase.title, remoteCase.description),
          source: "backend"
        };
      }
      return {
        ...remoteCase,
        slug: override.slug,
        title: override.title,
        description: override.description,
        logoUrl: override.logoUrl,
        priceAtomic: override.priceAtomic,
        isActive: override.isActive,
        volatilityIndex: override.volatilityIndex,
        volatilityTier: override.volatilityTier,
        updatedAt: override.updatedAt,
        itemCount: override.items.length || remoteCase.itemCount,
        tags: normalizeTagSet(override.tags),
        source: "admin-override"
      };
    })
    .filter((item) => includeInvisible || item.isActive);

  const mappedLocal = localCases.map(toMarketplaceListItem).filter((item) => includeInvisible || item.isActive);
  return [...mergedRemote, ...mappedLocal];
};

export const applyManagedDataToDetails = (remoteDetails: CaseDetails): CaseMarketplaceDetails => {
  const override = getManagedCaseForRemoteId(remoteDetails.id);
  if (!override) {
    return {
      ...remoteDetails,
      tags: deriveCaseTags(remoteDetails.title, remoteDetails.description),
      source: "backend"
    };
  }
  return {
    ...remoteDetails,
    slug: override.slug,
    title: override.title,
    description: override.description,
    logoUrl: override.logoUrl,
    priceAtomic: override.priceAtomic,
    isActive: override.isActive,
    volatilityIndex: override.volatilityIndex,
    volatilityTier: override.volatilityTier,
    items: override.items.length ? override.items : remoteDetails.items,
    updatedAt: override.updatedAt,
    tags: override.tags,
    source: "admin-override"
  };
};

export const toFormItems = (items: CaseItem[]): AdminCaseFormItem[] =>
  items.map((item, idx) => ({
    id: item.id,
    name: item.name,
    imageUrl: item.imageUrl || "",
    valueCoins: fromAtomicString(item.valueAtomic),
    dropRate: String(item.dropRate),
    sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : idx,
    isActive: item.isActive
  }));
