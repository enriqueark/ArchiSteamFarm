import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
const CENTER_INDEX = 11;
const HISTORY_STORAGE_KEY = "roulette-color-history-v2";
const BET_ORDER: BetColor[] = ["RED", "GREEN", "BLACK", "BAIT"];
const BOT_NAMES = [
  "duck3",
  "GongGong420",
  "Jaylow",
  "ladocshpetorsk",
  "Plzhn csgoroll.com",
  "tohoxpa",
  "Lxvii",
  "n1kita",
  "swift77",
  "bobjr"
];
const BOT_STAKES = [0.5, 1, 2, 5, 7, 10, 15, 25, 50, 75, 100];
const MAX_PLAY_AMOUNT = 1000;

// Rule set requested:
//  - 1 green
//  - 7 reds (including BAIT_RED)
//  - 7 blacks (including BAIT_BLACK)
//  - BAIT slots are left/right of green
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
    actionClass: "bg-[#8b4040] hover:bg-[#a24c4c]"
  },
  GREEN: {
    label: "GREEN",
    multiplier: 14,
    chipClass: "bg-[#1e9e57] border-[#5add97]",
    accentClass: "text-[#61e09e]",
    actionClass: "bg-[#1b6f45] hover:bg-[#238b57]"
  },
  BLACK: {
    label: "BLACK",
    multiplier: 2,
    chipClass: "bg-[#2f333b] border-[#666f7d]",
    accentClass: "text-[#c4ccd8]",
    actionClass: "bg-[#3b4350] hover:bg-[#4a5566]"
  },
  BAIT: {
    label: "BAIT",
    multiplier: 7,
    chipClass: "bg-gradient-to-r from-[#a34646] to-[#31363f] border-[#b89b4f]",
    accentClass: "text-[#ebcf7f]",
    actionClass: "bg-gradient-to-r from-[#883b3b] to-[#3b404a] hover:from-[#a54a4a] hover:to-[#4a505d]"
  }
};

const randomId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const randomFrom = <T,>(rows: T[]): T => rows[Math.floor(Math.random() * rows.length)];

const randomWheelSlot = (): WheelSlot => WHEEL_LAYOUT[Math.floor(Math.random() * WHEEL_LAYOUT.length)];

const buildInitialTrack = (): WheelSlot[] => {
  const seed = Math.floor(Math.random() * WHEEL_LAYOUT.length);
  return Array.from({ length: 23 }, (_, idx) => WHEEL_LAYOUT[(seed + idx) % WHEEL_LAYOUT.length]);
};

const createEmptyPanels = (): Record<BetColor, ColorPanel> => ({
  RED: { plays: 0, net: 0, entries: [] },
  GREEN: { plays: 0, net: 0, entries: [] },
  BLACK: { plays: 0, net: 0, entries: [] },
  BAIT: { plays: 0, net: 0, entries: [] }
});

const pickRandomBetColor = (): BetColor => {
  const roll = Math.random();
  if (roll < 0.41) return "RED";
  if (roll < 0.82) return "BLACK";
  if (roll < 0.92) return "GREEN";
  return "BAIT";
};

const generateBotEntries = (count = 22): BetEntry[] =>
  Array.from({ length: count }, () => ({
    id: randomId(),
    userLabel: randomFrom(BOT_NAMES),
    color: pickRandomBetColor(),
    amount: randomFrom(BOT_STAKES),
    isUser: false
  }));

const toHistoryEntry = (slot: WheelSlot): HistoryEntry => ({
  color: slot.color,
  isBait: slot.isBait,
  baitColor: slot.isBait ? (slot.color === "RED" ? "RED" : "BLACK") : null
});

const formatAmount = (value: number): string =>
  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatSignedAmount = (value: number): string => `${value >= 0 ? "+" : ""}${formatAmount(value)}`;

const toMinutesSeconds = (value: number): string => `00:${String(Math.max(0, value)).padStart(2, "0")}`;

const didBetWin = (betColor: BetColor, winner: WheelSlot): boolean => {
  if (betColor === "BAIT") return winner.isBait;
  if (betColor === "GREEN") return winner.color === "GREEN";
  if (betColor === "RED") return winner.color === "RED";
  return winner.color === "BLACK";
};

const getWinnerLabel = (slot: WheelSlot): string => {
  if (slot.kind === "BAIT_RED") return "BAIT RED won (left of green)";
  if (slot.kind === "BAIT_BLACK") return "BAIT BLACK won (right of green)";
  return `${slot.color} won`;
};

const getTileClass = (slot: WheelSlot): string => {
  if (slot.color === "RED") {
    return `bg-gradient-to-b from-[#a34747] to-[#6e2d2d] border-[#7f3838] ${slot.isBait ? "ring-2 ring-[#d9ba67]/80" : ""}`;
  }
  if (slot.color === "GREEN") {
    return "bg-gradient-to-b from-[#259b5a] to-[#175c38] border-[#2b8f57]";
  }
  return `bg-gradient-to-b from-[#3a4048] to-[#22262d] border-[#4a515c] ${slot.isBait ? "ring-2 ring-[#d9ba67]/80" : ""}`;
};

const isHistoryEntry = (value: unknown): value is HistoryEntry => {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<HistoryEntry>;
  const colorOk = row.color === "RED" || row.color === "GREEN" || row.color === "BLACK";
  const baitOk = row.baitColor === "RED" || row.baitColor === "BLACK" || row.baitColor === null;
  return colorOk && typeof row.isBait === "boolean" && baitOk;
};

export default function RoulettePage() {
  const [roundNumber, setRoundNumber] = useState(1);
  const [countdown, setCountdown] = useState(SPIN_INTERVAL_SECONDS);
  const [isSpinning, setIsSpinning] = useState(false);
  const [statusText, setStatusText] = useState("Waiting for next spin");
  const [selectedColor, setSelectedColor] = useState<BetColor>("RED");
  const [playAmountInput, setPlayAmountInput] = useState("1");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [trackSlots, setTrackSlots] = useState<WheelSlot[]>(buildInitialTrack);
  const [roundEntries, setRoundEntries] = useState<BetEntry[]>([]);
  const [lastPanels, setLastPanels] = useState<Record<BetColor, ColorPanel>>(createEmptyPanels());
  const [notice, setNotice] = useState<string | null>(null);

  const spinIntervalRef = useRef<number | null>(null);

  const currentAmount = useMemo(() => {
    const normalized = Number(playAmountInput.replace(",", "."));
    if (!Number.isFinite(normalized)) return 0;
    return Math.max(0, normalized);
  }, [playAmountInput]);

  useEffect(() => {
    setRoundEntries(generateBotEntries());
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
    return () => {
      if (spinIntervalRef.current !== null) {
        window.clearInterval(spinIntervalRef.current);
        spinIntervalRef.current = null;
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
      setRoundEntries(generateBotEntries());
    },
    [roundEntries]
  );

  const runSpin = useCallback(() => {
    if (isSpinning) return;
    setIsSpinning(true);
    setStatusText("Spinning...");
    setNotice(null);
    const winner = randomWheelSlot();
    let ticks = 0;
    const maxTicks = 46;

    if (spinIntervalRef.current !== null) {
      window.clearInterval(spinIntervalRef.current);
      spinIntervalRef.current = null;
    }

    spinIntervalRef.current = window.setInterval(() => {
      ticks += 1;
      setTrackSlots((previous) => [...previous.slice(1), randomWheelSlot()]);

      if (ticks >= maxTicks) {
        if (spinIntervalRef.current !== null) {
          window.clearInterval(spinIntervalRef.current);
          spinIntervalRef.current = null;
        }
        setTrackSlots((previous) => {
          const next = [...previous];
          next[CENTER_INDEX] = winner;
          return next;
        });
        settleRound(winner);
        setRoundNumber((value) => value + 1);
        setIsSpinning(false);
        setCountdown(SPIN_INTERVAL_SECONDS);
        setStatusText(getWinnerLabel(winner));
      }
    }, 80);
  }, [isSpinning, settleRound]);

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
      setNotice("Round is spinning. Wait for next one.");
      return;
    }
    if (!Number.isFinite(currentAmount) || currentAmount <= 0) {
      setNotice("Enter a valid amount before betting.");
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
    setNotice(`Bet placed on ${BET_THEME[color].label}.`);
  };

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
              <span className={`h-2.5 w-2.5 rounded-full border ${BET_THEME[color].chipClass}`} />
              <span>{historyCount[color]}</span>
            </div>
          ))}
        </div>
        <div className="mb-2 flex flex-wrap gap-2">
          {last10.map((entry, index) => (
            <span
              key={`${entry.color}-${entry.isBait}-${index}`}
              className={`h-5 w-5 rounded border ${
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
        <p className="text-[11px] text-[#868a94]">
          Layout rule: 1 green, 7 red, 7 black. BAIT is the left/right slot next to green (one red bait, one black bait).
        </p>
      </div>

      <div className="rounded-xl border border-[#2e3138] bg-[#1b1d22] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#969aa4]">Round #{roundNumber}</p>
            <p className="text-sm font-medium text-[#d5d8de]">{statusText}</p>
          </div>
          <div className="rounded-lg border border-[#3a3d45] bg-[#16181d] px-3 py-2 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9a9ea8]">Next spin</p>
            <p className="font-mono text-lg font-bold text-[#f2f3f6]">{isSpinning ? "--:--" : toMinutesSeconds(countdown)}</p>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-[#30343c] bg-[#15171b] px-3 py-4">
          <div className="pointer-events-none absolute bottom-2 left-1/2 top-2 z-20 w-[2px] -translate-x-1/2 rounded-full bg-white/85 shadow-[0_0_12px_rgba(255,255,255,0.3)]" />
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-[56px] w-[56px] -translate-x-1/2 -translate-y-1/2 rounded-md border border-white/15" />
          <div className="flex items-center gap-2">
            {trackSlots.map((slot, index) => (
              <div
                key={`${slot.kind}-${index}`}
                className={`relative h-11 w-11 shrink-0 rounded-md border ${getTileClass(slot)} ${
                  index === CENTER_INDEX ? "ring-2 ring-white/20" : ""
                }`}
              >
                {slot.isBait && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#ebcf7f]" />
                )}
              </div>
            ))}
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
            className="h-8 rounded-md border border-[#3b3e46] bg-[#191c22] px-2.5 text-xs font-bold text-[#b8bcc5] hover:bg-[#22252d]"
          >
            X
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current + 1)}
            className="h-8 rounded-md border border-[#3b3e46] bg-[#191c22] px-2.5 text-xs font-bold text-[#b8bcc5] hover:bg-[#22252d]"
          >
            +1
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current + 10)}
            className="h-8 rounded-md border border-[#3b3e46] bg-[#191c22] px-2.5 text-xs font-bold text-[#b8bcc5] hover:bg-[#22252d]"
          >
            +10
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current + 100)}
            className="h-8 rounded-md border border-[#3b3e46] bg-[#191c22] px-2.5 text-xs font-bold text-[#b8bcc5] hover:bg-[#22252d]"
          >
            +100
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current + 1000)}
            className="h-8 rounded-md border border-[#3b3e46] bg-[#191c22] px-2.5 text-xs font-bold text-[#b8bcc5] hover:bg-[#22252d]"
          >
            +1000
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current / 2)}
            className="h-8 rounded-md border border-[#3b3e46] bg-[#191c22] px-2.5 text-xs font-bold text-[#b8bcc5] hover:bg-[#22252d]"
          >
            1/2
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current * 2)}
            className="h-8 rounded-md border border-[#3b3e46] bg-[#191c22] px-2.5 text-xs font-bold text-[#b8bcc5] hover:bg-[#22252d]"
          >
            X2
          </button>
          <button
            type="button"
            onClick={() => setPlayAmountInput(String(MAX_PLAY_AMOUNT))}
            className="h-8 rounded-md border border-[#3b3e46] bg-[#191c22] px-2.5 text-xs font-bold text-[#b8bcc5] hover:bg-[#22252d]"
          >
            MAX
          </button>
        </div>
        {notice && <p className="mt-2 text-xs font-medium text-[#b9bdc6]">{notice}</p>}
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
                  <span className={`h-3.5 w-3.5 rounded-full border ${BET_THEME[color].chipClass}`} />
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
                className={`mb-3 h-9 w-full rounded-md text-xs font-bold tracking-[0.08em] text-white transition-colors ${
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
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                            entry.isUser ? "bg-[#464b55] text-[#f0f2f5]" : "bg-[#30343c] text-[#c1c5cd]"
                          }`}
                        >
                          {entry.userLabel.charAt(0).toUpperCase()}
                        </span>
                        <span className={`truncate ${entry.isUser ? "text-[#eceef2]" : "text-[#b2b6bf]"}`}>{entry.userLabel}</span>
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
