import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";

import { getCaseDetails, getCases, openCase, type CaseItem, type CaseOpeningResult } from "@/lib/api";
import {
  applyManagedCasesToList,
  applyManagedDataToDetails,
  getManagedLocalCaseById,
  type CaseMarketplaceDetails
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

type RarityTier = "COVERT" | "CLASSIFIED" | "RESTRICTED" | "MIL_SPEC" | "INDUSTRIAL";

const rarityMeta: Record<RarityTier, { color: string }> = {
  COVERT: { color: "#ef4444" },
  CLASSIFIED: { color: "#ec4899" },
  RESTRICTED: { color: "#a855f7" },
  MIL_SPEC: { color: "#3b82f6" },
  INDUSTRIAL: { color: "#e5e7eb" }
};

const inferRarityTier = (item: CaseItem): RarityTier => {
  const normalizedName = item.name.toLowerCase();
  if (normalizedName.includes("covert")) return "COVERT";
  if (normalizedName.includes("classified")) return "CLASSIFIED";
  if (normalizedName.includes("restricted")) return "RESTRICTED";
  if (normalizedName.includes("mil-spec") || normalizedName.includes("mil spec")) return "MIL_SPEC";
  if (normalizedName.includes("industrial") || normalizedName.includes("consumer")) return "INDUSTRIAL";

  const drop = Number(item.dropRate);
  if (Number.isFinite(drop)) {
    if (drop <= 0.6) return "COVERT";
    if (drop <= 2.5) return "CLASSIFIED";
    if (drop <= 8) return "RESTRICTED";
    if (drop <= 18) return "MIL_SPEC";
  }
  return "INDUSTRIAL";
};

const tierOrder = ["L", "M", "H", "I"] as const;
const tierColor: Record<(typeof tierOrder)[number], string> = {
  L: "#22c55e",
  M: "#eab308",
  H: "#f97316",
  I: "#ef4444"
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
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-4">
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

export default function CaseDetailPage() {
  const router = useRouter();
  const toast = useToast();
  const caseId = typeof router.query.caseId === "string" ? router.query.caseId : null;

  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [caseDetails, setCaseDetails] = useState<CaseMarketplaceDetails | null>(null);
  const [lastOpening, setLastOpening] = useState<CaseOpeningResult | null>(null);
  const [topTierModal, setTopTierModal] = useState<CaseOpeningResult | null>(null);

  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      const localCase = getManagedLocalCaseById(caseId);
      if (localCase) {
        if (!cancelled) setCaseDetails(localCase);
        return;
      }

      const remoteCases = await getCases();
      const merged = applyManagedCasesToList(remoteCases, { includeInvisible: false });
      const selected = merged.find((item) => item.id === caseId);
      if (!selected) {
        throw new Error("Case not found.");
      }
      const details = await getCaseDetails(selected.id);
      if (!cancelled) {
        setCaseDetails(applyManagedDataToDetails(details));
      }
    };

    load()
      .catch((error) => {
        if (!cancelled) {
          toast.showError(error instanceof Error ? error.message : "Failed to load case.");
          void router.push("/cases");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [caseId, toast, router]);

  const orderedItems = useMemo(() => {
    if (!caseDetails) return [];
    return [...caseDetails.items].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
  }, [caseDetails]);

  const openCaseNow = async () => {
    if (!caseDetails || opening) return;
    if (caseDetails.source === "admin-local") {
      toast.showError("Local admin preview cases cannot be opened until published in backend.");
      return;
    }
    setOpening(true);
    try {
      const result = await openCase(caseDetails.id);
      setLastOpening(result);
      requestLiveWinsRefresh();
      toast.showSuccess(`You won ${result.item.name} (${fmtCoins(result.item.valueAtomic)} COINS).`);
      if (result.topTierEligible) {
        setTopTierModal(result);
      }
    } catch (error) {
      toast.showError(error instanceof Error ? error.message : "Failed to open case.");
    } finally {
      setOpening(false);
    }
  };

  if (loading) {
    return <div className="rounded-[12px] border border-[#1f3450] bg-[#07131f] p-4 text-sm text-[#9db3cc]">Loading case...</div>;
  }

  if (!caseDetails) {
    return <div className="rounded-[12px] border border-[#412935] bg-[#1e0f16] p-4 text-sm text-[#ffb9c2]">Case not found.</div>;
  }

  return (
    <div className="space-y-5">
      <Link href="/cases" className="inline-flex items-center gap-2 rounded-[8px] border border-[#2a3f59] bg-[#0a1829] px-3 py-2 text-sm font-semibold text-[#c4d4e6]">
        <span>{"<"}</span>
        <span>Back</span>
      </Link>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="rounded-[12px] border border-[#1f3450] bg-[#0b1728] p-4">
          <div className="flex h-[112px] items-center justify-center rounded-[10px] bg-[#0e2135]">
            {caseDetails.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={caseDetails.logoUrl} alt={caseDetails.title} className="h-[86px] w-[86px] object-contain" />
            ) : (
              <span className="text-sm text-[#5f7894]">No image</span>
            )}
          </div>

          <h1 className="mt-3 text-center text-[17px] font-bold text-white">{caseDetails.title}</h1>

          <div className="mt-1 flex items-center justify-center gap-1.5 text-[#f5c14f]">
            <img src="/assets/coin-dino-original.png" alt="" className="h-[22px] w-[22px] object-contain" />
            <span className="text-[16px] font-bold">{fmtCoins(caseDetails.priceAtomic)}</span>
          </div>

          <div className="mt-3">
            <div className="mb-1 grid grid-cols-4 text-center text-[10px] font-semibold text-[#9cb0c7]">
              {tierOrder.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-1">
              {tierOrder.map((label) => {
                const active = label === caseDetails.volatilityTier;
                return (
                  <span
                    key={label}
                    className="h-[3px] rounded-full"
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

          <button
            type="button"
            onClick={() => void openCaseNow()}
            disabled={opening || caseDetails.source === "admin-local"}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-[8px] border border-[#16a34a] bg-gradient-to-b from-[#22c55e] to-[#15803d] px-3 py-2 text-sm font-bold text-white shadow-[0_0_16px_rgba(34,197,94,0.35)] disabled:opacity-50"
          >
            {opening ? (
              "Opening..."
            ) : (
              <>
                <span>OPEN FOR</span>
                <img src="/assets/coin-dino-original.png" alt="" className="h-[18px] w-[18px] object-contain" />
                <span>{fmtCoins(caseDetails.priceAtomic)}</span>
              </>
            )}
          </button>
        </div>

        <div className="rounded-[12px] border border-[#1f3450] bg-[#060f1d]">
          <div className="flex h-[100%] min-h-[250px] items-center justify-center rounded-[12px] bg-gradient-to-b from-[#081426] to-[#050d18]">
            {lastOpening?.item?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lastOpening.item.imageUrl} alt={lastOpening.item.name} className="h-[120px] w-[120px] object-contain" />
            ) : (
              <p className="text-sm text-[#5f7894]">Case opening animation area</p>
            )}
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-bold uppercase text-[#bfd0e4]">Case Contain</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
          {orderedItems.map((item) => {
            const rarity = inferRarityTier(item);
            const meta = rarityMeta[rarity];
            const drop = Number(item.dropRate);
            const dropLabel = Number.isFinite(drop) ? `${drop.toFixed(drop < 1 ? 3 : 2)}%` : "0.00%";
            return (
              <div
                key={item.id}
                className="relative overflow-hidden rounded-[10px] border border-[#323a46] bg-[#171d28] p-1.5"
              >
                <div className="relative">
                  <div className="mb-1 flex items-center justify-start text-[10px] text-[#b8c3d3]">
                    <span className="rounded bg-[#263245]/80 px-1.5 py-[1px] font-semibold">{dropLabel}</span>
                  </div>
                  <div
                    className="mb-2 flex h-[98px] items-center justify-center rounded-[8px]"
                    style={{
                      background: `radial-gradient(circle at 50% 46%, ${meta.color}40 0%, ${meta.color}14 36%, rgba(110,118,129,0.18) 65%, rgba(30,36,46,0.85) 100%)`
                    }}
                  >
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.imageUrl} alt={item.name} className="h-[86px] w-[86px] object-contain" />
                    ) : (
                      <span className="text-xs text-[#617a96]">No image</span>
                    )}
                  </div>
                  <p className="line-clamp-2 text-[12px] font-semibold text-white">{item.name}</p>
                  <div className="mt-1 flex items-center gap-1.5 text-[#f5c14f]">
                    <img src="/assets/coin-dino-original.png" alt="" className="h-[18px] w-[18px] object-contain" />
                    <span className="text-[14px] font-semibold">{fmtCoins(item.valueAtomic)}</span>
                  </div>
                </div>
              </div>
            );
          })}
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
