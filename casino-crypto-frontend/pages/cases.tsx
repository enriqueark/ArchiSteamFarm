import { useEffect, useMemo, useState } from "react";

import {
  getCaseDetails,
  getCases,
  getMyCaseOpenings,
  openCase,
  type CaseOpeningResult
} from "@/lib/api";
import {
  CASE_CATEGORY_TAGS,
  applyManagedCasesToList,
  applyManagedDataToDetails,
  getManagedLocalCaseById,
  type CaseCategoryTag,
  type CaseMarketplaceDetails,
  type CaseMarketplaceItem
} from "@/lib/caseAdminStore";
import { requestLiveWinsRefresh } from "@/lib/liveWinsTicker";
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

const isInPriceRange = (atomic: string, rangeKey: string): boolean => {
  const selected = PRICE_RANGE_OPTIONS.find((option) => option.key === rangeKey) || PRICE_RANGE_OPTIONS[0];
  const price = toCoins(atomic);
  if (selected.min !== null && price < selected.min) return false;
  if (selected.max !== null && price > selected.max) return false;
  return true;
};

function TopTierReveal({ opening, onClose }: { opening: CaseOpeningResult; onClose: () => void }) {
  const [phase, setPhase] = useState<"spin" | "reveal">("spin");
  const [ticker, setTicker] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setPhase("reveal"), 1800);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (phase !== "spin") return;
    const interval = window.setInterval(() => setTicker((prev) => prev + 1), 120);
    return () => window.clearInterval(interval);
  }, [phase]);

  const spinItem =
    opening.topTierItems.length > 0
      ? opening.topTierItems[ticker % opening.topTierItems.length]
      : opening.item;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-2xl rounded-[12px] border border-[#2a4462] bg-[#091522] p-5 shadow-2xl">
        <h3 className="text-xl font-bold text-white">Top Tier Pull</h3>
        <p className="mt-1 text-sm text-[#9cb2cb]">Rerolling among highest-value items in this case.</p>

        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
          {opening.topTierItems.map((item) => {
            const highlighted = phase === "spin" ? item.id === spinItem.id : item.id === opening.item.id;
            return (
              <div
                key={item.id}
                className={`rounded-[8px] border p-2 text-xs ${
                  highlighted
                    ? "border-[#f5c14f] bg-[#f5c14f]/15 text-[#ffe39d]"
                    : "border-[#1f3550] bg-[#0a1727] text-[#9bb1c8]"
                }`}
              >
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt={item.name} className="mb-2 h-14 w-full object-contain" />
                ) : null}
                <p className="truncate font-semibold">{item.name}</p>
                <p>{fmtCoins(item.valueAtomic)} COINS</p>
              </div>
            );
          })}
        </div>

        {phase === "reveal" ? (
          <div className="mt-4 rounded-[8px] border border-emerald-500/40 bg-emerald-500/10 p-3">
            <p className="text-sm text-emerald-200">You won:</p>
            <p className="text-lg font-bold text-emerald-100">
              {opening.item.name} • {fmtCoins(opening.item.valueAtomic)} COINS
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-[#9cb2cb]">Rerolling...</p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={phase !== "reveal"}
            onClick={onClose}
            className="rounded-[8px] bg-[#264a6e] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CasesPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [cases, setCases] = useState<CaseMarketplaceItem[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<CaseMarketplaceDetails | null>(null);
  const [myOpenings, setMyOpenings] = useState<CaseOpeningResult[]>([]);
  const [topTierModal, setTopTierModal] = useState<CaseOpeningResult | null>(null);

  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<CaseCategoryTag>("ALL");
  const [priceRange, setPriceRange] = useState<(typeof PRICE_RANGE_OPTIONS)[number]["key"]>("ALL");
  const [sortBy, setSortBy] = useState<(typeof SORT_OPTIONS)[number]["key"]>("NEWEST");

  const refreshCases = async () => {
    const remoteCases = await getCases();
    const mergedCases = applyManagedCasesToList(remoteCases, { includeInvisible: false });
    setCases(mergedCases);
    const fallbackCaseId = mergedCases[0]?.id ?? null;
    setSelectedCaseId((prev) => (prev && mergedCases.some((item) => item.id === prev) ? prev : fallbackCaseId));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([refreshCases(), getMyCaseOpenings(20).catch(() => [])])
      .then(([, openings]) => {
        if (!cancelled) {
          setMyOpenings(openings);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedCaseId) {
      setSelectedCase(null);
      return;
    }
    const localCase = getManagedLocalCaseById(selectedCaseId);
    if (localCase) {
      setSelectedCase(localCase);
      return;
    }
    let cancelled = false;
    getCaseDetails(selectedCaseId)
      .then((details) => {
        if (!cancelled) {
          setSelectedCase(applyManagedDataToDetails(details));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.showError(error instanceof Error ? error.message : "Failed to load case details.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCaseId, toast]);

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

  useEffect(() => {
    if (!visibleCases.length) {
      setSelectedCaseId(null);
      return;
    }
    if (!selectedCaseId || !visibleCases.some((item) => item.id === selectedCaseId)) {
      setSelectedCaseId(visibleCases[0].id);
    }
  }, [visibleCases, selectedCaseId]);

  const handleOpenCase = async () => {
    if (!selectedCase || opening) return;
    if (selectedCase.source === "admin-local") {
      toast.showError("Local admin preview cases cannot be opened until published in backend.");
      return;
    }
    setOpening(true);
    try {
      const result = await openCase(selectedCase.id);
      toast.showSuccess(`You won ${result.item.name} (${fmtCoins(result.item.valueAtomic)} COINS).`);
      requestLiveWinsRefresh();
      const openings = await getMyCaseOpenings(20).catch(() => []);
      setMyOpenings(openings);
      if (result.topTierEligible) {
        setTopTierModal(result);
      }
    } catch (error) {
      toast.showError(error instanceof Error ? error.message : "Failed to open case.");
    } finally {
      setOpening(false);
    }
  };

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
          {visibleCases.map((c) => {
            const selected = c.id === selectedCaseId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCaseId(c.id)}
                className={`group rounded-[12px] border bg-[#0a1726] p-3 text-left transition-all ${
                  selected
                    ? "border-[#3b6fa5] shadow-[0_0_0_1px_rgba(59,111,165,0.4)]"
                    : "border-[#1c324b] hover:border-[#2e4f73]"
                }`}
              >
                <div className="relative mb-2 flex h-[92px] items-center justify-center rounded-[8px] border border-[#1a2e46] bg-[#0d2135]">
                  {c.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.logoUrl} alt={c.title} className="h-[78px] w-[78px] object-contain" />
                  ) : (
                    <span className="text-xs text-[#5f7997]">No image</span>
                  )}
                </div>
                <p className="truncate text-[12px] font-semibold text-white">{c.title}</p>
                <div className="mt-1 flex items-center gap-1.5 text-[#f5c14f]">
                  <img src="/assets/coin-dino-original.png" alt="" className="h-[16px] w-[16px] object-contain" />
                  <span className="text-[13px] font-bold leading-none">{fmtCoins(c.priceAtomic)}</span>
                </div>
                <div className="mt-2 grid grid-cols-4 rounded-[6px] border border-[#1a2e46] bg-[#081321]">
                  {tierOrder.map((tier) => {
                    const active = c.volatilityTier === tier;
                    return (
                      <span
                        key={tier}
                        className={`py-0.5 text-center text-[10px] font-semibold ${
                          active ? "bg-[#17324e] text-white" : "text-[#6f8aa7]"
                        }`}
                      >
                        {tier}
                      </span>
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!loading && visibleCases.length === 0 ? (
        <div className="rounded-[12px] border border-[#1f3450] bg-[#07131f] p-4 text-sm text-[#9db3cc]">
          No cases match the selected filters.
        </div>
      ) : null}

      {selectedCase ? (
        <div className="rounded-[12px] border border-[#1f3450] bg-[#07131f] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">{selectedCase.title}</h2>
              <p className="text-xs text-[#90a7c0]">{selectedCase.description || "No description provided."}</p>
            </div>
            <button
              type="button"
              onClick={() => void handleOpenCase()}
              disabled={opening || selectedCase.source === "admin-local"}
              className="rounded-[10px] border border-[#f15b64] bg-gradient-to-b from-[#ff4f59] to-[#d7232f] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {opening ? "Opening..." : `Open for ${fmtCoins(selectedCase.priceAtomic)}`}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {selectedCase.items.map((item) => (
              <div key={item.id} className="rounded-[10px] border border-[#1c324b] bg-[#0b1b2c] p-2">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt={item.name} className="mb-2 h-[70px] w-full object-contain" />
                ) : (
                  <div className="mb-2 flex h-[70px] items-center justify-center text-xs text-[#66809f]">No image</div>
                )}
                <p className="truncate text-[12px] font-semibold text-white">{item.name}</p>
                <div className="text-[11px] text-[#9cb0c7]">
                  {fmtCoins(item.valueAtomic)} • {Number(item.dropRate).toFixed(2)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-[12px] border border-[#1f3450] bg-[#07131f] p-4">
        <h3 className="text-sm font-bold uppercase text-[#b9cae0]">Recent Openings</h3>
        <div className="mt-2 space-y-2">
          {myOpenings.length ? (
            myOpenings.slice(0, 10).map((row) => (
              <div key={row.openingId} className="rounded-[8px] border border-[#1d334b] bg-[#0a1726] p-2 text-sm text-[#b8c9de]">
                <p className="font-semibold text-white">
                  {row.caseTitle} → {row.item.name}
                </p>
                <p className="text-[12px]">
                  Paid {fmtCoins(row.priceAtomic)} / Won {fmtCoins(row.payoutAtomic)} / Profit {fmtCoins(row.profitAtomic)}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-[#8ea4be]">No openings yet.</p>
          )}
        </div>
      </div>

      {topTierModal ? (
        <TopTierReveal
          opening={topTierModal}
          onClose={() => {
            setTopTierModal(null);
          }}
        />
      ) : null}
    </div>
  );
}
