import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { getCases } from "@/lib/api";
import {
  CASE_CATEGORY_TAGS,
  applyManagedCasesToList,
  type CaseCategoryTag,
  type CaseMarketplaceItem
} from "@/lib/caseAdminStore";
import { useToast } from "@/lib/toast";

const toCoins = (atomic: string): number => {
  const n = Number(atomic);
  if (!Number.isFinite(n)) return 0;
  return n / 1e8;
};

const fmtCoins = (atomic: string): string =>
  toCoins(atomic).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const PRICE_RANGE_OPTIONS = [
  { key: "ALL", label: "All", min: null, max: null },
  { key: "500_PLUS", label: "500.00+", min: 500, max: null },
  { key: "250_500", label: "250.00 - 500.00", min: 250, max: 500 },
  { key: "100_250", label: "100.00 - 250.00", min: 100, max: 250 },
  { key: "25_100", label: "25.00 - 100.00", min: 25, max: 100 },
  { key: "10_25", label: "10.00 - 25.00", min: 10, max: 25 },
  { key: "5_10", label: "5.00 - 10.00", min: 5, max: 10 },
  { key: "0_5", label: "0.50 - 5.00", min: 0.5, max: 5 }
] as const;

const SORT_OPTIONS = [
  { key: "PRICE_DESC", label: "Price Descending" },
  { key: "PRICE_ASC", label: "Price Ascending" },
  { key: "VOL_DESC", label: "Volatility Descending" },
  { key: "VOL_ASC", label: "Volatility Ascending" },
  { key: "NEWEST", label: "Newest" }
] as const;

const tierOrder = ["L", "M", "H", "I"] as const;
const tierColor: Record<(typeof tierOrder)[number], string> = {
  L: "#22c55e",
  M: "#eab308",
  H: "#f97316",
  I: "#ef4444"
};

const isInPriceRange = (atomic: string, rangeKey: string): boolean => {
  const selected = PRICE_RANGE_OPTIONS.find((option) => option.key === rangeKey) || PRICE_RANGE_OPTIONS[0];
  const price = toCoins(atomic);
  if (selected.min !== null && price < selected.min) return false;
  if (selected.max !== null && price > selected.max) return false;
  return true;
};

function VolatilityBar({ tier }: { tier: "L" | "M" | "H" | "I" }) {
  return (
    <div className="mt-2">
      <div className="mb-1 grid grid-cols-4 text-center text-[10px] font-semibold text-[#9cb0c7]">
        {tierOrder.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1">
        {tierOrder.map((label) => {
          const active = label === tier;
          return (
            <span
              key={label}
              className="h-[3px] rounded-full transition-all"
              style={{
                backgroundColor: tierColor[label],
                opacity: active ? 1 : 0.35,
                boxShadow: active ? `0 0 8px ${tierColor[label]}` : "none"
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function CasesPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState<CaseMarketplaceItem[]>([]);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<CaseCategoryTag>("ALL");
  const [priceRange, setPriceRange] = useState<(typeof PRICE_RANGE_OPTIONS)[number]["key"]>("ALL");
  const [sortBy, setSortBy] = useState<(typeof SORT_OPTIONS)[number]["key"]>("NEWEST");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCases()
      .then((remote) => {
        if (cancelled) return;
        setCases(applyManagedCasesToList(remote, { includeInvisible: false }));
      })
      .catch((error) => {
        if (!cancelled) {
          toast.showError(error instanceof Error ? error.message : "Failed to load cases.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const visibleCases = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = cases.filter((item) => {
      if (activeTag !== "ALL" && !item.tags.includes(activeTag)) return false;
      if (!isInPriceRange(item.priceAtomic, priceRange)) return false;
      if (!normalizedSearch) return true;
      return item.title.toLowerCase().includes(normalizedSearch);
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortBy === "PRICE_DESC") return Number(b.priceAtomic) - Number(a.priceAtomic);
      if (sortBy === "PRICE_ASC") return Number(a.priceAtomic) - Number(b.priceAtomic);
      if (sortBy === "VOL_DESC") return b.volatilityIndex - a.volatilityIndex;
      if (sortBy === "VOL_ASC") return a.volatilityIndex - b.volatilityIndex;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return sorted;
  }, [cases, search, activeTag, priceRange, sortBy]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9db3cc]">Search</p>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Enter keyword"
            className="h-[42px] w-full rounded-[10px] border border-[#1f3450] bg-[#07131f] px-4 text-sm text-white outline-none transition-colors focus:border-[#325a84]"
          />
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9db3cc]">Price Range</p>
          <select
            value={priceRange}
            onChange={(event) => setPriceRange(event.target.value as (typeof PRICE_RANGE_OPTIONS)[number]["key"])}
            className="h-[42px] w-full rounded-[10px] border border-[#1f3450] bg-[#07131f] px-3 text-sm font-semibold text-white outline-none"
          >
            {PRICE_RANGE_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9db3cc]">Sort By</p>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as (typeof SORT_OPTIONS)[number]["key"])}
            className="h-[42px] w-full rounded-[10px] border border-[#1f3450] bg-[#07131f] px-3 text-sm font-semibold text-white outline-none"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {CASE_CATEGORY_TAGS.map((tag) => {
          const active = activeTag === tag;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag(tag)}
              className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.04em] transition-colors ${
                active
                  ? "border-[#f5c14f] bg-[#f5c14f]/10 text-[#ffd56f]"
                  : "border-[#1f3450] bg-[#07131f] text-[#a4b7ce] hover:border-[#2e4f73]"
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="rounded-[12px] border border-[#1f3450] bg-[#07131f] p-5 text-sm text-[#9db3cc]">Loading cases...</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {visibleCases.map((c) => (
            <Link
              key={c.id}
              href={`/cases/${encodeURIComponent(c.id)}`}
              className="group overflow-hidden rounded-[12px] border border-[#1c324b] bg-[#0a1726] text-left transition-all hover:border-[#2e4f73]"
            >
              <div className="relative flex h-[116px] items-center justify-center bg-gradient-to-b from-[#0f2740] to-[#0a1726]">
                {c.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.logoUrl} alt={c.title} className="h-[96px] w-[96px] object-contain" />
                ) : (
                  <span className="text-xs text-[#5f7997]">No image</span>
                )}
              </div>
              <div className="px-3 pb-3 pt-2">
                <p className="truncate text-center text-[13px] font-semibold text-white">{c.title}</p>
                <div className="mt-1 flex items-center justify-center gap-1.5 text-[#f5c14f]">
                  <img src="/assets/coin-dino-original.png" alt="" className="h-[24px] w-[24px] object-contain" />
                  <span className="text-[14px] font-bold leading-none">{fmtCoins(c.priceAtomic)}</span>
                </div>
                <VolatilityBar tier={c.volatilityTier} />
              </div>
            </Link>
          ))}
        </div>
      )}

      {!loading && visibleCases.length === 0 ? (
        <div className="rounded-[12px] border border-[#1f3450] bg-[#07131f] p-4 text-sm text-[#9db3cc]">
          No cases match the selected filters.
        </div>
      ) : null}
    </div>
  );
}
