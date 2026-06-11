import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getCaseDetails, getCases, openCase, type CaseItem, type CaseOpeningResult } from "@/lib/api";
import {
  applyManagedCasesToList,
  applyManagedDataToDetails,
  getManagedLocalCaseById,
  type CaseMarketplaceDetails
} from "@/lib/caseAdminStore";
import { requestLiveWinsRefresh } from "@/lib/liveWinsTicker";
import { syncCaseOpenBalance } from "@/lib/refreshBalance";
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

const REEL_ITEM_WIDTH = 164;
const REEL_ITEM_HEIGHT = 220;
const REEL_ITEM_GAP = 26;
const REEL_STRIDE = REEL_ITEM_WIDTH + REEL_ITEM_GAP;
const REEL_TRACK_LENGTH = 120;
const REEL_START_INDEX = 10;
const INITIAL_REEL_PHASE = 0;

const getEaseOut = (progress: number): number => 1 - Math.pow(1 - progress, 4);
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const buildRandomTrack = (items: CaseItem[], length: number): CaseItem[] => {
  if (items.length === 0 || length <= 0) return [];
  return Array.from({ length }, () => items[Math.floor(Math.random() * items.length)]);
};

const getIndexAtPointer = (phase: number, pointerPx: number, trackLength: number): number | null => {
  if (trackLength <= 0) return null;
  return clamp(Math.round((phase + pointerPx - REEL_ITEM_WIDTH / 2) / REEL_STRIDE), 0, trackLength - 1);
};

const getPhaseForIndex = (index: number, pointerPx: number): number => index * REEL_STRIDE + REEL_ITEM_WIDTH / 2 - pointerPx;

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
  const laneRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const laneWidthRef = useRef(860);
  const slotNodeRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [isReelSpinning, setIsReelSpinning] = useState(false);
  const [laneWidth, setLaneWidth] = useState(860);
  const [spinPhase, setSpinPhase] = useState(INITIAL_REEL_PHASE);
  const [reelTrackSlots, setReelTrackSlots] = useState<Array<{ repeatedIndex: number; item: CaseItem }>>([]);
  const [winnerReveal, setWinnerReveal] = useState<{ index: number; item: CaseItem } | null>(null);
  const [renderedPointerIndex, setRenderedPointerIndex] = useState<number | null>(null);
  const [caseDetails, setCaseDetails] = useState<CaseMarketplaceDetails | null>(null);
  const [lastOpening, setLastOpening] = useState<CaseOpeningResult | null>(null);
  const [topTierModal, setTopTierModal] = useState<CaseOpeningResult | null>(null);
  const spinPhaseRef = useRef(spinPhase);

  useEffect(() => {
    spinPhaseRef.current = spinPhase;
  }, [spinPhase]);

  useEffect(() => {
    laneWidthRef.current = laneWidth;
  }, [laneWidth]);

  const clearRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

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

  useEffect(() => {
    if (!laneRef.current || typeof ResizeObserver === "undefined") return;
    const element = laneRef.current;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setLaneWidth(Math.max(460, Math.floor(element.clientWidth)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      clearRaf();
    };
  }, [clearRaf]);

  const getPointerPxNow = useCallback(() => {
    const measured = laneRef.current?.clientWidth;
    if (typeof measured === "number" && measured > 0) {
      laneWidthRef.current = measured;
      return measured * 0.5;
    }
    return laneWidthRef.current * 0.5;
  }, []);

  const resolveRenderedIndexAtPointer = useCallback((): number | null => {
    const lane = laneRef.current;
    if (!lane || slotNodeRefs.current.size === 0) return null;
    const laneRect = lane.getBoundingClientRect();
    const pointerX = laneRect.left + laneRect.width * 0.5;
    const entries = Array.from(slotNodeRefs.current.entries());
    let bestIndex: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [index, node] of entries) {
      const rect = node.getBoundingClientRect();
      if (pointerX >= rect.left && pointerX <= rect.right) {
        return index;
      }
      const center = rect.left + rect.width * 0.5;
      const distance = Math.abs(center - pointerX);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return bestIndex;
  }, []);

  const resolveCenterCorrectionForIndex = useCallback((index: number): number | null => {
    const lane = laneRef.current;
    const node = slotNodeRefs.current.get(index);
    if (!lane || !node) return null;
    const laneRect = lane.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const pointerX = laneRect.left + laneRect.width * 0.5;
    const nodeCenterX = nodeRect.left + nodeRect.width * 0.5;
    return nodeCenterX - pointerX;
  }, []);

  useEffect(() => {
    if (orderedItems.length === 0) return;
    const track = buildRandomTrack(orderedItems, REEL_TRACK_LENGTH);
    setReelTrackSlots(track.map((item, repeatedIndex) => ({ repeatedIndex, item })));
    const pointer = getPointerPxNow();
    const initial = REEL_START_INDEX * REEL_STRIDE + REEL_ITEM_WIDTH / 2 - pointer;
    spinPhaseRef.current = initial;
    setSpinPhase(initial);
    setWinnerReveal(null);
  }, [getPointerPxNow, orderedItems]);

  const pointerPx = laneWidth * 0.5;

  const activeStripIndex = useMemo(() => {
    return getIndexAtPointer(spinPhase, pointerPx, reelTrackSlots.length);
  }, [pointerPx, reelTrackSlots.length, spinPhase]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setRenderedPointerIndex(resolveRenderedIndexAtPointer());
    });
    return () => cancelAnimationFrame(frame);
  }, [laneWidth, reelTrackSlots.length, resolveRenderedIndexAtPointer, spinPhase]);

  const highlightedStripIndex = !isReelSpinning && winnerReveal ? winnerReveal.index : renderedPointerIndex ?? activeStripIndex;

  const runOpeningAnimation = useCallback(
    async (winningItem: CaseItem): Promise<void> => {
      if (orderedItems.length === 0) return;
      clearRaf();
      setIsReelSpinning(true);
      setWinnerReveal(null);

      let winnerLayout = orderedItems.findIndex((item) => item.id === winningItem.id);
      if (winnerLayout < 0) {
        winnerLayout = orderedItems.findIndex((item) => item.name === winningItem.name);
      }
      if (winnerLayout < 0) {
        winnerLayout = 0;
      }

      const track = buildRandomTrack(orderedItems, REEL_TRACK_LENGTH);
      const boundaryBaseIndex = REEL_TRACK_LENGTH - 17 - Math.floor(Math.random() * 3);
      const passEnabled = Math.random() < 0.68;
      const targetIndex = passEnabled ? boundaryBaseIndex + 1 : boundaryBaseIndex;
      const winnerItem = orderedItems[winnerLayout] ?? winningItem;
      track[targetIndex] = winnerItem;
      setReelTrackSlots(track.map((item, repeatedIndex) => ({ repeatedIndex, item })));

      const pointerStart = getPointerPxNow();
      const startPhase = getPhaseForIndex(REEL_START_INDEX, pointerStart);
      const pointerEnd = getPointerPxNow();
      const boundaryPhase = getPhaseForIndex(boundaryBaseIndex + 0.5, pointerEnd);
      const preBaitPhase = boundaryPhase - REEL_STRIDE * (0.42 + Math.random() * 0.13);
      const boundaryMargin = REEL_STRIDE * (0.016 + Math.random() * 0.02);
      const baitPhase = passEnabled ? boundaryPhase + boundaryMargin : boundaryPhase - boundaryMargin;
      const finalPhaseGuess = getPhaseForIndex(targetIndex, pointerEnd);
      const cruiseDurationMs = 4400 + Math.floor(Math.random() * 1100);
      const baitDurationMs = 760 + Math.floor(Math.random() * 340);
      const settleDurationMs = passEnabled
        ? 860 + Math.floor(Math.random() * 280)
        : 780 + Math.floor(Math.random() * 240);

      const animateSegment = async (from: number, to: number, durationMs: number, easing: (progress: number) => number) => {
        if (!Number.isFinite(durationMs) || durationMs <= 0 || Math.abs(to - from) < 0.001) {
          spinPhaseRef.current = to;
          setSpinPhase(to);
          return;
        }
        await new Promise<void>((resolve) => {
          const startedAt = performance.now();
          const tick = (ts: number) => {
            const progress = Math.max(0, Math.min(1, (ts - startedAt) / durationMs));
            const mix = easing(progress);
            const next = from + (to - from) * mix;
            spinPhaseRef.current = next;
            setSpinPhase(next);
            if (progress < 1) {
              rafRef.current = requestAnimationFrame(tick);
              return;
            }
            spinPhaseRef.current = to;
            setSpinPhase(to);
            rafRef.current = null;
            resolve();
          };
          rafRef.current = requestAnimationFrame(tick);
        });
      };

      const measureCenteredTargetPhase = async (fallbackPhase: number): Promise<number> => {
        await new Promise<void>((resolve) => {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            resolve();
          });
        });
        const correctionPx = resolveCenterCorrectionForIndex(targetIndex);
        if (correctionPx === null || !Number.isFinite(correctionPx)) {
          return fallbackPhase;
        }
        const from = spinPhaseRef.current;
        const measuredTarget = from + correctionPx;
        // Safety clamp: keep the correction inside the same skin neighborhood,
        // so the final easing can never cross into a different slot.
        const neighborhoodLimit = REEL_STRIDE * 0.22;
        const boundedDelta = clamp(measuredTarget - fallbackPhase, -neighborhoodLimit, neighborhoodLimit);
        return fallbackPhase + boundedDelta;
      };

      spinPhaseRef.current = startPhase;
      setSpinPhase(startPhase);

      await animateSegment(startPhase, preBaitPhase, cruiseDurationMs, getEaseOut);
      await animateSegment(preBaitPhase, baitPhase, baitDurationMs, (progress) => 1 - Math.pow(1 - progress, 4));
      const settleTargetPhase = await measureCenteredTargetPhase(finalPhaseGuess);
      await animateSegment(baitPhase, settleTargetPhase, settleDurationMs, (progress) => 1 - Math.pow(1 - progress, 3.4));

      setIsReelSpinning(false);
      setWinnerReveal({ index: targetIndex, item: winnerItem });
    },
    [clearRaf, getPointerPxNow, orderedItems, resolveCenterCorrectionForIndex]
  );

  const openCaseNow = async () => {
    if (!caseDetails || opening) return;
    if (caseDetails.source === "admin-local") {
      toast.showError("Local admin preview cases cannot be opened until published in backend.");
      return;
    }
    setOpening(true);
    let balanceSyncStarted = false;
    let balanceSyncCompleted = false;
    try {
      syncCaseOpenBalance({ type: "start", costAtomic: caseDetails.priceAtomic });
      balanceSyncStarted = true;
      const result = await openCase(caseDetails.id);
      await runOpeningAnimation(result.item);
      syncCaseOpenBalance({ type: "end", payoutAtomic: result.payoutAtomic });
      balanceSyncCompleted = true;
      setLastOpening(result);
      requestLiveWinsRefresh();
      toast.showSuccess(`You won ${result.item.name} (${fmtCoins(result.item.valueAtomic)} COINS).`);
      if (result.topTierEligible) {
        setTopTierModal(result);
      }
    } catch (error) {
      if (balanceSyncStarted && !balanceSyncCompleted) {
        syncCaseOpenBalance({ type: "cancel" });
      }
      toast.showError(error instanceof Error ? error.message : "Failed to open case.");
    } finally {
      setOpening(false);
    }
  };

  const caseContainsCards = useMemo(
    () =>
      orderedItems.map((item) => {
        const rarity = inferRarityTier(item);
        const meta = rarityMeta[rarity];
        const drop = Number(item.dropRate);
        const dropLabel = Number.isFinite(drop) ? `${drop.toFixed(drop < 1 ? 3 : 2)}%` : "0.00%";
        return (
          <div key={item.id} className="relative overflow-hidden rounded-[10px] border border-[#353a43] bg-[#1a1f27] p-1.5">
            <div className="relative">
              <div className="mb-1 flex items-center justify-start text-[10px] font-semibold text-[#b8c3d3]">
                <span>{dropLabel}</span>
              </div>
              <div className="mb-2 relative flex h-[110px] items-center justify-center">
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background: `radial-gradient(circle at 50% 48%, ${meta.color}4f 0%, ${meta.color}22 40%, rgba(34,37,45,0.1) 74%, rgba(26,31,39,0.0) 100%)`
                  }}
                />
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt={item.name} className="relative z-[1] h-[102px] w-[102px] object-contain" />
                ) : (
                  <span className="text-xs text-[#617a96]">No image</span>
                )}
              </div>
              <p className="line-clamp-2 text-[12px] font-semibold text-white">{item.name}</p>
              <div className="mt-1 flex items-center gap-1.5 text-[#f5c14f]">
                <img src="/assets/coin-dino-original.png" alt="" className="h-[22px] w-[22px] object-contain" />
                <span className="text-[16px] font-semibold leading-none">{fmtCoins(item.valueAtomic)}</span>
              </div>
            </div>
          </div>
        );
      }),
    [orderedItems]
  );

  if (loading) {
    return <div className="rounded-[12px] border border-[#1f3450] bg-[#07131f] p-4 text-sm text-[#9db3cc]">Loading case...</div>;
  }

  if (!caseDetails) {
    return <div className="rounded-[12px] border border-[#412935] bg-[#1e0f16] p-4 text-sm text-[#ffb9c2]">Case not found.</div>;
  }

  return (
    <div className="space-y-5">
      <Link href="/cases" className="inline-flex items-center gap-2 rounded-[8px] border border-[#3b3d44] bg-[#1a1c22] px-3 py-2 text-sm font-semibold text-[#ff4d6d]">
        <span>{"<"}</span>
        <span>Back</span>
      </Link>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="rounded-[12px] border border-[#2d3139] bg-[#13161c] p-4">
          <div className="flex h-[112px] items-center justify-center rounded-[10px] bg-[#1b1f27]">
            {caseDetails.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={caseDetails.logoUrl} alt={caseDetails.title} className="h-[86px] w-[86px] object-contain" />
            ) : (
              <span className="text-sm text-[#5f7894]">No image</span>
            )}
          </div>

          <h1 className="mt-3 text-center text-[17px] font-bold text-white">{caseDetails.title}</h1>

          <div className="mt-1 flex items-center justify-center gap-1.5 text-[#f5c14f]">
            <img src="/assets/coin-dino-original.png" alt="" className="h-[30px] w-[30px] object-contain" />
            <span className="text-[20px] font-bold leading-none">{fmtCoins(caseDetails.priceAtomic)}</span>
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
                <img src="/assets/coin-dino-original.png" alt="" className="h-[24px] w-[24px] object-contain" />
                <span>{fmtCoins(caseDetails.priceAtomic)}</span>
              </>
            )}
          </button>
        </div>

        <div className="rounded-[12px] border border-[#2d3139] bg-[#12161d] p-3">
          <div ref={laneRef} className="relative overflow-hidden rounded-[10px] border border-[#27303c] bg-gradient-to-b from-[#10161e] via-[#0f141b] to-[#0a0f15]">
            <div className="pointer-events-none absolute inset-y-3 left-1/2 z-30 w-[2px] -translate-x-1/2 rounded-full bg-white/90 shadow-[0_0_16px_rgba(255,255,255,0.4)]" />
            <div className="relative h-[320px]">
              <div className="absolute left-0 top-0 h-full w-full will-change-transform">
                {reelTrackSlots.map(({ repeatedIndex, item }) => {
                  const active = highlightedStripIndex === repeatedIndex;
                  const isWinnerSlot = !!winnerReveal && !isReelSpinning && winnerReveal.index === repeatedIndex;
                  const left = repeatedIndex * REEL_STRIDE - spinPhase;
                  return (
                    <div
                      key={`${repeatedIndex}-${item.id}`}
                      ref={(node) => {
                        if (node) {
                          slotNodeRefs.current.set(repeatedIndex, node);
                        } else {
                          slotNodeRefs.current.delete(repeatedIndex);
                        }
                      }}
                      className={`absolute top-1/2 z-10 box-border flex -translate-y-1/2 flex-col items-center justify-center ${
                        active || isWinnerSlot
                          ? "z-20 scale-[1.08] opacity-100 drop-shadow-[0_0_16px_rgba(245,193,79,0.55)]"
                          : "opacity-55"
                      }`}
                      style={{ left, width: REEL_ITEM_WIDTH, height: REEL_ITEM_HEIGHT }}
                    >
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className={`h-[148px] w-[148px] object-contain ${isWinnerSlot ? "winner-float" : ""}`}
                        />
                      ) : (
                        <span className="text-xs text-[#5f7894]">No image</span>
                      )}
                      {isWinnerSlot ? (
                        <>
                          <p className="mt-1 line-clamp-1 text-center text-[11px] font-bold text-white">{winnerReveal.item.name}</p>
                          <div className="mt-1 flex w-full items-center justify-center gap-1 text-[#f5c14f] leading-none">
                            <img src="/assets/coin-dino-original.png" alt="" className="h-[30px] w-[30px] shrink-0 object-contain" />
                            <span className="flex items-center text-[18px] font-extrabold leading-none">{fmtCoins(winnerReveal.item.valueAtomic)}</span>
                          </div>
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="pointer-events-none absolute inset-0 z-[5] bg-[linear-gradient(90deg,rgba(10,14,20,0.58)_0%,rgba(10,14,20,0.22)_10%,rgba(10,14,20,0.01)_22%,rgba(10,14,20,0.01)_78%,rgba(10,14,20,0.22)_90%,rgba(10,14,20,0.58)_100%)]" />
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-bold uppercase text-[#bfd0e4]">Case Contain</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-9">{caseContainsCards}</div>
      </div>

      {topTierModal ? (
        <TopTierReveal
          opening={topTierModal}
          onClose={() => {
            setTopTierModal(null);
          }}
        />
      ) : null}
      <style jsx>{`
        @keyframes winnerFloat {
          0%,
          100% {
            transform: translateY(-1px);
          }
          50% {
            transform: translateY(2px);
          }
        }
        .winner-float {
          animation: winnerFloat 1.6s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
