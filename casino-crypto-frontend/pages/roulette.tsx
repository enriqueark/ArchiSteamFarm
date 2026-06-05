import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/lib/toast";

type BetColor = "RED" | "GREEN" | "BLACK" | "BAIT";
type BaseColor = "RED" | "GREEN" | "BLACK";
type WheelSlotKind = "RED" | "BLACK" | "GREEN" | "BAIT_RED" | "BAIT_BLACK";

type WheelSlot = {
  kind: WheelSlotKind;
  color: BaseColor;
  isBait: boolean;
  baitSide: "LEFT" | "RIGHT" | null;
};

type HistoryEntry = {
  color: BaseColor;
  isBait: boolean;
  baitColor: "RED" | "BLACK" | null;
};

type BetEntry = {
  id: string;
  userLabel: string;
  color: BetColor;
  amount: number;
  isUser: boolean;
};

type SettledEntry = BetEntry & {
  net: number;
};

type ColorPanel = {
  plays: number;
  net: number;
  entries: SettledEntry[];
};

const SPIN_INTERVAL_SECONDS = 15;
const HISTORY_STORAGE_KEY = "roulette-color-history-v3";
const BET_ORDER: BetColor[] = ["RED", "GREEN", "BLACK", "BAIT"];
const MAX_PLAY_AMOUNT = 1000;

const SLOT_SIZE = 58;
const SLOT_GAP = 8;
const SLOT_STRIDE = SLOT_SIZE + SLOT_GAP;

// Exact pattern:
// - 1 green
// - 7 reds (includes BAIT_RED)
// - 7 blacks (includes BAIT_BLACK)
// - BAIT is always left/right of green
const WHEEL_LAYOUT: WheelSlot[] = [
  { kind: "RED", color: "RED", isBait: false, baitSide: null },
  { kind: "BLACK", color: "BLACK", isBait: false, baitSide: null },
  { kind: "RED", color: "RED", isBait: false, baitSide: null },
  { kind: "BLACK", color: "BLACK", isBait: false, baitSide: null },
  { kind: "RED", color: "RED", isBait: false, baitSide: null },
  { kind: "BLACK", color: "BLACK", isBait: false, baitSide: null },
  { kind: "BAIT_RED", color: "RED", isBait: true, baitSide: "LEFT" },
  { kind: "GREEN", color: "GREEN", isBait: false, baitSide: null },
  { kind: "BAIT_BLACK", color: "BLACK", isBait: true, baitSide: "RIGHT" },
  { kind: "RED", color: "RED", isBait: false, baitSide: null },
  { kind: "BLACK", color: "BLACK", isBait: false, baitSide: null },
  { kind: "RED", color: "RED", isBait: false, baitSide: null },
  { kind: "BLACK", color: "BLACK", isBait: false, baitSide: null },
  { kind: "RED", color: "RED", isBait: false, baitSide: null },
  { kind: "BLACK", color: "BLACK", isBait: false, baitSide: null }
];
const WHEEL_LENGTH = WHEEL_LAYOUT.length;

const BET_THEME: Record<
  BetColor,
  {
    label: string;
    multiplier: number;
    chipClass: string;
    accentClass: string;
    actionClass: string;
  }
> = {
  RED: {
    label: "RED",
    multiplier: 2,
    chipClass: "bg-[#cf5858] border-[#f08d8d]",
    accentClass: "text-[#ff8c8c]",
    actionClass:
      "bg-gradient-to-r from-[#e46464] to-[#bf4c4c] hover:from-[#f07f7f] hover:to-[#ce5a5a] shadow-[0_0_22px_rgba(225,100,100,0.65)]"
  },
  GREEN: {
    label: "GREEN",
    multiplier: 14,
    chipClass: "bg-[#1e9e57] border-[#5add97]",
    accentClass: "text-[#61e09e]",
    actionClass:
      "bg-gradient-to-r from-[#31cc7a] to-[#1f9658] hover:from-[#43e08c] hover:to-[#27ab66] shadow-[0_0_22px_rgba(51,204,122,0.62)]"
  },
  BLACK: {
    label: "BLACK",
    multiplier: 2,
    chipClass: "bg-[#2f333b] border-[#666f7d]",
    accentClass: "text-[#c4ccd8]",
    actionClass:
      "bg-gradient-to-r from-[#6c788d] to-[#485466] hover:from-[#8291ab] hover:to-[#596985] shadow-[0_0_22px_rgba(114,127,151,0.56)]"
  },
  BAIT: {
    label: "BAIT",
    multiplier: 7,
    chipClass: "bg-gradient-to-r from-[#a34646] to-[#31363f] border-[#b89b4f]",
    accentClass: "text-[#ebcf7f]",
    actionClass:
      "bg-gradient-to-r from-[#cb5a5a] to-[#666f81] hover:from-[#e16f6f] hover:to-[#79859c] shadow-[0_0_22px_rgba(214,183,108,0.58)]"
  }
};

const randomId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const mod = (value: number, size: number): number => ((value % size) + size) % size;
const randomWheelSlot = (): WheelSlot => WHEEL_LAYOUT[Math.floor(Math.random() * WHEEL_LENGTH)];

const createEmptyPanels = (): Record<BetColor, ColorPanel> => ({
  RED: { plays: 0, net: 0, entries: [] },
  GREEN: { plays: 0, net: 0, entries: [] },
  BLACK: { plays: 0, net: 0, entries: [] },
  BAIT: { plays: 0, net: 0, entries: [] }
});

const toHistoryEntry = (slot: WheelSlot): HistoryEntry => ({
  color: slot.color,
  isBait: slot.isBait,
  baitColor: slot.isBait ? (slot.color === "RED" ? "RED" : "BLACK") : null
});

const isHistoryEntry = (value: unknown): value is HistoryEntry => {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<HistoryEntry>;
  const colorOk = row.color === "RED" || row.color === "GREEN" || row.color === "BLACK";
  const baitOk = row.baitColor === "RED" || row.baitColor === "BLACK" || row.baitColor === null;
  return colorOk && typeof row.isBait === "boolean" && baitOk;
};

const didBetWin = (betColor: BetColor, winner: WheelSlot): boolean => {
  if (betColor === "BAIT") return winner.isBait;
  if (betColor === "GREEN") return winner.color === "GREEN";
  if (betColor === "RED") return winner.color === "RED";
  return winner.color === "BLACK";
};

const getWinnerLabel = (slot: WheelSlot): string => {
  if (slot.kind === "BAIT_RED") return "BAIT RED landed (BAIT x7 + RED x2)";
  if (slot.kind === "BAIT_BLACK") return "BAIT BLACK landed (BAIT x7 + BLACK x2)";
  return `${slot.color} won`;
};

const getTileClass = (slot: WheelSlot): string => {
  if (slot.color === "RED") {
    return `bg-gradient-to-b from-[#b04f4f] to-[#712f2f] border-[#894141] ${slot.isBait ? "ring-2 ring-[#dabf72]/85" : ""}`;
  }
  if (slot.color === "GREEN") {
    return "bg-gradient-to-b from-[#28a861] to-[#1a6c40] border-[#329b61]";
  }
  return `bg-gradient-to-b from-[#454b55] to-[#2a2f36] border-[#555c68] ${slot.isBait ? "ring-2 ring-[#dabf72]/85" : ""}`;
};

const formatAmount = (value: number): string =>
  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatSignedAmount = (value: number): string => `${value >= 0 ? "+" : ""}${formatAmount(value)}`;
const toMinutesSeconds = (value: number): string => `00:${String(Math.max(0, value)).padStart(2, "0")}`;

export default function RoulettePage() {
  const toast = useToast();
  const laneRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const [roundNumber, setRoundNumber] = useState(1);
  const [countdown, setCountdown] = useState(SPIN_INTERVAL_SECONDS);
  const [isSpinning, setIsSpinning] = useState(false);
  const [statusText, setStatusText] = useState("Waiting for next spin");
  const [selectedColor, setSelectedColor] = useState<BetColor>("RED");
  const [playAmountInput, setPlayAmountInput] = useState("1");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [roundEntries, setRoundEntries] = useState<BetEntry[]>([]);
  const [lastPanels, setLastPanels] = useState<Record<BetColor, ColorPanel>>(createEmptyPanels());
  const [pointerRatio, setPointerRatio] = useState(0.5);
  const [laneWidth, setLaneWidth] = useState(920);
  const [spinTranslate, setSpinTranslate] = useState(0);

  const spinTranslateRef = useRef(spinTranslate);
  useEffect(() => {
    spinTranslateRef.current = spinTranslate;
  }, [spinTranslate]);

  const currentAmount = useMemo(() => {
    const normalized = Number(playAmountInput.replace(",", "."));
    if (!Number.isFinite(normalized)) return 0;
    return Math.max(0, normalized);
  }, [playAmountInput]);

  useEffect(() => {
    const fallbackHistory = Array.from({ length: 100 }, () => toHistoryEntry(randomWheelSlot()));
    if (typeof window === "undefined") {
      setHistory(fallbackHistory);
      return;
    }
    try {
      const stored = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!stored) {
        setHistory(fallbackHistory);
        return;
      }
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const sanitized = parsed.filter(isHistoryEntry).slice(0, 100);
        setHistory(sanitized.length > 0 ? sanitized : fallbackHistory);
        return;
      }
      setHistory(fallbackHistory);
    } catch {
      setHistory(fallbackHistory);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || history.length === 0) return;
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 100)));
  }, [history]);

  useEffect(() => {
    if (!laneRef.current || typeof ResizeObserver === "undefined") return;
    const element = laneRef.current;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setLaneWidth(Math.max(320, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const settleRound = useCallback(
    (winner: WheelSlot) => {
      setHistory((previous) => [toHistoryEntry(winner), ...previous].slice(0, 100));
      setLastPanels(() => {
        const grouped = createEmptyPanels();
        roundEntries.forEach((entry) => {
          const multiplier = BET_THEME[entry.color].multiplier;
          const net = didBetWin(entry.color, winner) ? entry.amount * (multiplier - 1) : -entry.amount;
          grouped[entry.color].entries.push({ ...entry, net });
          grouped[entry.color].plays += 1;
          grouped[entry.color].net += net;
        });
        BET_ORDER.forEach((color) => {
          grouped[color].entries.sort((a, b) => b.net - a.net);
          grouped[color].entries = grouped[color].entries.slice(0, 8);
        });
        return grouped;
      });
      setRoundEntries([]);
    },
    [roundEntries]
  );

  const runSpin = useCallback(() => {
    if (isSpinning) return;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const nextPointerRatio = 0.12 + Math.random() * 0.76;
    setPointerRatio(nextPointerRatio);
    const pointerPx = laneWidth * nextPointerRatio;

    const currentActiveIndex = Math.round((spinTranslateRef.current + pointerPx - SLOT_SIZE / 2) / SLOT_STRIDE);
    const winnerIndex = Math.floor(Math.random() * WHEEL_LENGTH);
    const winner = WHEEL_LAYOUT[winnerIndex];

    let targetGlobalIndex = currentActiveIndex + WHEEL_LENGTH * (2 + Math.floor(Math.random() * 2)) + Math.floor(Math.random() * WHEEL_LENGTH);
    const correction = mod(winnerIndex - mod(targetGlobalIndex, WHEEL_LENGTH), WHEEL_LENGTH);
    targetGlobalIndex += correction;

    const startTranslate = spinTranslateRef.current;
    const endTranslate = targetGlobalIndex * SLOT_STRIDE + SLOT_SIZE / 2 - pointerPx;
    const durationMs = 5800 + Math.random() * 1800;
    const startedAt = performance.now();

    setIsSpinning(true);
    setStatusText("Spinning...");

    const animate = (now: number) => {
      const elapsed = now - startedAt;
      const progress = Math.max(0, Math.min(1, elapsed / durationMs));
      const easeOut = 1 - (1 - progress) ** 3;
      const feint = progress > 0.68 ? Math.sin((progress - 0.68) * 42) * (1 - progress) * 0.045 : 0;
      const mix = Math.max(0, Math.min(1, easeOut + feint));
      const currentTranslate = startTranslate + (endTranslate - startTranslate) * mix;

      spinTranslateRef.current = currentTranslate;
      setSpinTranslate(currentTranslate);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      spinTranslateRef.current = endTranslate;
      setSpinTranslate(endTranslate);
      rafRef.current = null;
      settleRound(winner);
      setRoundNumber((value) => value + 1);
      setIsSpinning(false);
      setCountdown(SPIN_INTERVAL_SECONDS);
      setStatusText(getWinnerLabel(winner));
    };

    rafRef.current = requestAnimationFrame(animate);
  }, [isSpinning, laneWidth, settleRound]);

  useEffect(() => {
    if (isSpinning) return;
    if (countdown <= 0) {
      runSpin();
      return;
    }
    const timer = window.setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, isSpinning, runSpin]);

  const updateAmount = (updater: (current: number) => number) => {
    const next = Math.min(MAX_PLAY_AMOUNT, Math.max(0, Math.round(updater(currentAmount) * 100) / 100));
    setPlayAmountInput(String(next));
  };

  const placeBet = (color: BetColor) => {
    setSelectedColor(color);
    if (isSpinning) {
      toast.showError("Round is spinning. Wait for next one.");
      return;
    }
    if (!Number.isFinite(currentAmount) || currentAmount <= 0) {
      toast.showError("Enter a valid amount before betting.");
      return;
    }

    const ticket: BetEntry = {
      id: randomId(),
      userLabel: "You",
      color,
      amount: currentAmount,
      isUser: true
    };
    setRoundEntries((previous) => [ticket, ...previous]);
    toast.showSuccess(`Bet placed on ${BET_THEME[color].label}.`);
  };

  const pointerPx = laneWidth * pointerRatio;
  const activeGlobalIndex = Math.round((spinTranslate + pointerPx - SLOT_SIZE / 2) / SLOT_STRIDE);
  const firstGlobalIndex = Math.floor(spinTranslate / SLOT_STRIDE) - 3;
  const renderCount = Math.ceil(laneWidth / SLOT_STRIDE) + 8;
  const visibleSlots = useMemo(
    () =>
      Array.from({ length: renderCount }, (_, offset) => {
        const globalIndex = firstGlobalIndex + offset;
        const slot = WHEEL_LAYOUT[mod(globalIndex, WHEEL_LENGTH)];
        const left = globalIndex * SLOT_STRIDE - spinTranslate;
        return { globalIndex, slot, left };
      }),
    [firstGlobalIndex, renderCount, spinTranslate]
  );

  const last100 = history.slice(0, 100);
  const last10 = last100.slice(0, 10);
  const historyCount = useMemo(
    () =>
      last100.reduce(
        (acc, item) => {
          if (item.color === "RED") acc.RED += 1;
          if (item.color === "GREEN") acc.GREEN += 1;
          if (item.color === "BLACK") acc.BLACK += 1;
          if (item.isBait) acc.BAIT += 1;
          return acc;
        },
        { RED: 0, GREEN: 0, BLACK: 0, BAIT: 0 }
      ),
    [last100]
  );

  return (
    <div className="space-y-4 pb-8">
      <div className="rounded-xl border border-[#2d3037] bg-[#1a1c21] p-4 shadow-[0_10px_32px_rgba(0,0,0,0.4)]">
        <div className="mb-2 flex flex-wrap items-center gap-3 text-xs font-semibold text-[#b4b7bf]">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[#8a8e98]">Last 100</span>
          {BET_ORDER.map((color) => (
            <div key={color} className="flex items-center gap-1.5">
              <span className={`h-4 w-4 rounded-full border ${BET_THEME[color].chipClass}`} />
              <span>{historyCount[color]}</span>
            </div>
          ))}
        </div>
        <div
          className="mb-2 grid gap-2"
          style={{ gridTemplateColumns: `repeat(${Math.min(10, last10.length || 10)}, minmax(0, 1fr))`, maxWidth: "460px" }}
        >
          {last10.map((entry, index) => (
            <span
              key={`${entry.color}-${entry.isBait}-${index}`}
              className={`h-7 w-full rounded border ${
                entry.color === "RED"
                  ? "bg-[#b64f4f] border-[#df7c7c]"
                  : entry.color === "GREEN"
                  ? "bg-[#21894f] border-[#4bc57d]"
                  : "bg-[#3a3f48] border-[#707988]"
              } ${entry.isBait ? "ring-2 ring-[#d3b96a]/80" : ""}`}
              title={entry.isBait ? `BAIT ${entry.baitColor}` : entry.color}
            />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[#2e3138] bg-[#1b1d22] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[#d5d8de]">{statusText}</p>
          </div>
          <div className="rounded-lg border border-[#3a3d45] bg-[#16181d] px-3 py-2 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9a9ea8]">Next spin</p>
            <p className="font-mono text-lg font-bold text-[#f2f3f6]">{isSpinning ? "--:--" : toMinutesSeconds(countdown)}</p>
          </div>
        </div>

        <div ref={laneRef} className="relative overflow-hidden rounded-xl border border-[#30343c] bg-[#15171b] px-2 py-4">
          <div
            className="pointer-events-none absolute bottom-2 top-2 z-30 w-[2px] -translate-x-1/2 rounded-full bg-white/85 shadow-[0_0_14px_rgba(255,255,255,0.35)]"
            style={{ left: `${pointerRatio * 100}%` }}
          />

          <div className="relative h-[58px]">
            {visibleSlots.map(({ globalIndex, slot, left }) => {
              const isActive = globalIndex === activeGlobalIndex;
              return (
                <div
                  key={`${globalIndex}-${slot.kind}`}
                  className={`absolute top-0 rounded-md border transition-all duration-100 ${getTileClass(slot)} ${
                    isActive ? "z-20 scale-[1.06] opacity-100 brightness-125 shadow-[0_0_22px_rgba(255,255,255,0.18)]" : "opacity-40"
                  }`}
                  style={{
                    left,
                    width: SLOT_SIZE,
                    height: SLOT_SIZE
                  }}
                >
                  {slot.isBait && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#ebcf7f]" />}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#2f323a] bg-[#1b1d22] p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#9da2ac]">Play amount</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-10 min-w-[180px] flex-1 items-center gap-2 rounded-md border border-[#353941] bg-[#16191e] px-3">
            <img src="/assets/coin-dino-original.png" alt="coin" className="h-4 w-4 object-contain" />
            <input
              value={playAmountInput}
              onChange={(event) => setPlayAmountInput(event.target.value)}
              className="w-full bg-transparent text-sm font-semibold text-[#e4e6eb] outline-none"
              placeholder="1"
              inputMode="decimal"
            />
          </div>

          <button
            type="button"
            onClick={() => setPlayAmountInput("0")}
            className="h-8 rounded-md border border-[#595d67] bg-[#2a2f39] px-2.5 text-xs font-bold text-[#e1e4ea] shadow-[0_0_10px_rgba(255,255,255,0.12)] hover:bg-[#363c48]"
          >
            X
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current + 1)}
            className="h-8 rounded-md border border-[#595d67] bg-[#2a2f39] px-2.5 text-xs font-bold text-[#e1e4ea] shadow-[0_0_10px_rgba(255,255,255,0.12)] hover:bg-[#363c48]"
          >
            +1
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current + 10)}
            className="h-8 rounded-md border border-[#595d67] bg-[#2a2f39] px-2.5 text-xs font-bold text-[#e1e4ea] shadow-[0_0_10px_rgba(255,255,255,0.12)] hover:bg-[#363c48]"
          >
            +10
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current + 100)}
            className="h-8 rounded-md border border-[#595d67] bg-[#2a2f39] px-2.5 text-xs font-bold text-[#e1e4ea] shadow-[0_0_10px_rgba(255,255,255,0.12)] hover:bg-[#363c48]"
          >
            +100
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current + 1000)}
            className="h-8 rounded-md border border-[#595d67] bg-[#2a2f39] px-2.5 text-xs font-bold text-[#e1e4ea] shadow-[0_0_10px_rgba(255,255,255,0.12)] hover:bg-[#363c48]"
          >
            +1000
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current / 2)}
            className="h-8 rounded-md border border-[#595d67] bg-[#2a2f39] px-2.5 text-xs font-bold text-[#e1e4ea] shadow-[0_0_10px_rgba(255,255,255,0.12)] hover:bg-[#363c48]"
          >
            1/2
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current * 2)}
            className="h-8 rounded-md border border-[#595d67] bg-[#2a2f39] px-2.5 text-xs font-bold text-[#e1e4ea] shadow-[0_0_10px_rgba(255,255,255,0.12)] hover:bg-[#363c48]"
          >
            X2
          </button>
          <button
            type="button"
            onClick={() => setPlayAmountInput(String(MAX_PLAY_AMOUNT))}
            className="h-8 rounded-md border border-[#595d67] bg-[#2a2f39] px-2.5 text-xs font-bold text-[#e1e4ea] shadow-[0_0_10px_rgba(255,255,255,0.12)] hover:bg-[#363c48]"
          >
            MAX
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4 md:grid-cols-2">
        {BET_ORDER.map((color) => {
          const panel = lastPanels[color];
          const pendingRows = roundEntries
            .filter((entry) => entry.color === color)
            .slice(0, 8)
            .map((entry) => ({ ...entry, net: 0 }));
          const rowsToRender = panel.entries.length > 0 ? panel.entries : pendingRows;
          const netClass = panel.net >= 0 ? "text-[#56d58f]" : "text-[#ff8080]";

          return (
            <div key={color} className="rounded-xl border border-[#33363f] bg-[#1b1d22] p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`h-5 w-5 rounded-full border ${BET_THEME[color].chipClass}`} />
                  <span className={`text-sm font-bold ${BET_THEME[color].accentClass}`}>Win {BET_THEME[color].multiplier}x</span>
                </div>
                {selectedColor === color && (
                  <span className="rounded border border-[#5a5e68] bg-[#24272d] px-1.5 py-0.5 text-[10px] font-semibold text-[#d7dae0]">
                    SELECTED
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => placeBet(color)}
                className={`mb-3 h-10 w-full rounded-md text-xs font-extrabold tracking-[0.1em] text-white transition-all ${
                  BET_THEME[color].actionClass
                }`}
              >
                PLAY
              </button>

              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-[#a2a7b0]">{panel.plays} Plays</span>
                <span className={`font-semibold ${netClass}`}>{formatSignedAmount(panel.net)}</span>
              </div>

              <div className="max-h-[210px] space-y-1 overflow-auto pr-1">
                {rowsToRender.length === 0 ? (
                  <p className="text-xs text-[#8b8f98]">No plays yet.</p>
                ) : (
                  rowsToRender.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between rounded-md bg-[#15181d] px-2 py-1.5 text-xs">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#464b55] text-[9px] font-bold text-[#f0f2f5]">
                          {entry.userLabel.charAt(0).toUpperCase()}
                        </span>
                        <span className="truncate text-[#eceef2]">{entry.userLabel}</span>
                      </div>
                      <span className={entry.net === 0 ? "text-[#d6d9de]" : entry.net > 0 ? "text-[#56d58f]" : "text-[#ff8080]"}>
                        {entry.net === 0 ? formatAmount(entry.amount) : formatSignedAmount(entry.net)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
