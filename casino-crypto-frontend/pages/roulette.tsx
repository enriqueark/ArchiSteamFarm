import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type RouletteColor = "RED" | "GREEN" | "BLACK" | "BAIT";

type BetEntry = {
  id: string;
  userLabel: string;
  color: RouletteColor;
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
const HISTORY_STORAGE_KEY = "roulette-color-history-v1";
const COLOR_ORDER: RouletteColor[] = ["RED", "GREEN", "BLACK", "BAIT"];
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

const COLOR_THEME: Record<
  RouletteColor,
  {
    label: string;
    multiplier: number;
    chipClass: string;
    tileClass: string;
    accentClass: string;
    actionClass: string;
  }
> = {
  RED: {
    label: "RED",
    multiplier: 2,
    chipClass: "bg-[#d74b4b] border-[#ef7a7a]",
    tileClass: "bg-gradient-to-b from-[#a33a3a] to-[#6d2525] border-[#7f2f2f]",
    accentClass: "text-[#ff7f7f]",
    actionClass: "bg-[#8b3434] hover:bg-[#9f3d3d]"
  },
  GREEN: {
    label: "GREEN",
    multiplier: 14,
    chipClass: "bg-[#13a85a] border-[#3ce68a]",
    tileClass: "bg-gradient-to-b from-[#13984f] to-[#0f5e36] border-[#1f9b58]",
    accentClass: "text-[#4be18f]",
    actionClass: "bg-[#0f6c3f] hover:bg-[#11834c]"
  },
  BLACK: {
    label: "BLACK",
    multiplier: 2,
    chipClass: "bg-[#3a4557] border-[#5e6e86]",
    tileClass: "bg-gradient-to-b from-[#303a4a] to-[#1f2733] border-[#384356]",
    accentClass: "text-[#a9bbd2]",
    actionClass: "bg-[#2f3f56] hover:bg-[#375074]"
  },
  BAIT: {
    label: "BAIT",
    multiplier: 7,
    chipClass: "bg-[#516029] border-[#95be33]",
    tileClass: "bg-gradient-to-b from-[#596b2d] to-[#35411b] border-[#6a8533]",
    accentClass: "text-[#b9ef46]",
    actionClass: "bg-[#4f6b28] hover:bg-[#648533]"
  }
};

const randomId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const pickWeightedColor = (): RouletteColor => {
  const roll = Math.random();
  if (roll < 0.43) return "RED";
  if (roll < 0.80) return "BLACK";
  if (roll < 0.90) return "GREEN";
  return "BAIT";
};

const buildInitialTrack = (): RouletteColor[] => Array.from({ length: 23 }, (_, idx) => COLOR_ORDER[idx % COLOR_ORDER.length]);

const createEmptyPanels = (): Record<RouletteColor, ColorPanel> => ({
  RED: { plays: 0, net: 0, entries: [] },
  GREEN: { plays: 0, net: 0, entries: [] },
  BLACK: { plays: 0, net: 0, entries: [] },
  BAIT: { plays: 0, net: 0, entries: [] }
});

const randomFrom = <T,>(rows: T[]): T => rows[Math.floor(Math.random() * rows.length)];

const generateBotEntries = (count = 22): BetEntry[] =>
  Array.from({ length: count }, () => ({
    id: randomId(),
    userLabel: randomFrom(BOT_NAMES),
    color: pickWeightedColor(),
    amount: randomFrom(BOT_STAKES),
    isUser: false
  }));

const formatAmount = (value: number): string =>
  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatSignedAmount = (value: number): string => `${value >= 0 ? "+" : ""}${formatAmount(value)}`;

const toMinutesSeconds = (value: number): string => `00:${String(Math.max(0, value)).padStart(2, "0")}`;

export default function RoulettePage() {
  const [roundNumber, setRoundNumber] = useState(1);
  const [countdown, setCountdown] = useState(SPIN_INTERVAL_SECONDS);
  const [isSpinning, setIsSpinning] = useState(false);
  const [statusText, setStatusText] = useState("Waiting for next spin");
  const [selectedColor, setSelectedColor] = useState<RouletteColor>("RED");
  const [playAmountInput, setPlayAmountInput] = useState("1");
  const [history, setHistory] = useState<RouletteColor[]>([]);
  const [trackColors, setTrackColors] = useState<RouletteColor[]>(buildInitialTrack);
  const [roundEntries, setRoundEntries] = useState<BetEntry[]>([]);
  const [lastPanels, setLastPanels] = useState<Record<RouletteColor, ColorPanel>>(createEmptyPanels());
  const [winningColor, setWinningColor] = useState<RouletteColor | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const spinIntervalRef = useRef<number | null>(null);

  const currentAmount = useMemo(() => {
    const normalized = Number(playAmountInput.replace(",", "."));
    if (!Number.isFinite(normalized)) return 0;
    return Math.max(0, normalized);
  }, [playAmountInput]);

  useEffect(() => {
    setRoundEntries(generateBotEntries());
    const fallbackHistory = Array.from({ length: 100 }, () => pickWeightedColor());
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
      const parsed = JSON.parse(stored) as RouletteColor[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const sanitized = parsed.filter((entry) => COLOR_ORDER.includes(entry)).slice(0, 100);
        setHistory(sanitized.length > 0 ? sanitized : fallbackHistory);
        return;
      }
      setHistory(fallbackHistory);
    } catch {
      setHistory(fallbackHistory);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || history.length === 0) {
      return;
    }
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
    (winner: RouletteColor) => {
      setWinningColor(winner);
      setHistory((previous) => [winner, ...previous].slice(0, 100));
      setLastPanels(() => {
        const grouped = createEmptyPanels();
        roundEntries.forEach((entry) => {
          const multiplier = COLOR_THEME[entry.color].multiplier;
          const net = entry.color === winner ? entry.amount * (multiplier - 1) : -entry.amount;
          grouped[entry.color].entries.push({ ...entry, net });
          grouped[entry.color].plays += 1;
          grouped[entry.color].net += net;
        });
        COLOR_ORDER.forEach((color) => {
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
    const winner = pickWeightedColor();
    let ticks = 0;
    const maxTicks = 44;

    if (spinIntervalRef.current !== null) {
      window.clearInterval(spinIntervalRef.current);
      spinIntervalRef.current = null;
    }

    spinIntervalRef.current = window.setInterval(() => {
      ticks += 1;
      setTrackColors((previous) => [...previous.slice(1), pickWeightedColor()]);

      if (ticks >= maxTicks) {
        if (spinIntervalRef.current !== null) {
          window.clearInterval(spinIntervalRef.current);
          spinIntervalRef.current = null;
        }
        setTrackColors((previous) => {
          const next = [...previous];
          next[CENTER_INDEX] = winner;
          return next;
        });
        settleRound(winner);
        setRoundNumber((value) => value + 1);
        setIsSpinning(false);
        setCountdown(SPIN_INTERVAL_SECONDS);
        setStatusText(`${COLOR_THEME[winner].label} won this round`);
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

  const placeBet = (color: RouletteColor) => {
    setSelectedColor(color);
    if (isSpinning) {
      setNotice("Round is spinning. Wait for the next one.");
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
    setNotice(`Bet placed on ${COLOR_THEME[color].label}.`);
  };

  const last100 = history.slice(0, 100);
  const last10 = last100.slice(0, 10);
  const historyCount = useMemo(
    () =>
      last100.reduce<Record<RouletteColor, number>>(
        (acc, color) => {
          acc[color] += 1;
          return acc;
        },
        { RED: 0, GREEN: 0, BLACK: 0, BAIT: 0 }
      ),
    [last100]
  );

  return (
    <div className="space-y-4 pb-8">
      <div className="rounded-xl border border-[#263245] bg-[#151c29] p-4 shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
        <div className="mb-2 flex flex-wrap items-center gap-3 text-xs font-semibold text-[#8d9eb6]">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[#70829b]">Last 100</span>
          {COLOR_ORDER.map((color) => (
            <div key={color} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full border ${COLOR_THEME[color].chipClass}`} />
              <span>{historyCount[color]}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {last10.map((color, index) => (
            <span
              key={`${color}-${index}`}
              className={`h-5 w-5 rounded-full border ${COLOR_THEME[color].chipClass}`}
              title={COLOR_THEME[color].label}
            />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[#293446] bg-[#151d2a] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8fa0b8]">Round #{roundNumber}</p>
            <p className="text-sm font-medium text-[#c4d2e8]">{statusText}</p>
          </div>
          <div className="rounded-lg border border-[#2a374c] bg-[#111826] px-3 py-2 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#7d90ac]">Next spin</p>
            <p className="font-mono text-lg font-bold text-[#f2f6ff]">{isSpinning ? "--:--" : toMinutesSeconds(countdown)}</p>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-[#233045] bg-[#0f1520] px-3 py-4">
          <div className="pointer-events-none absolute bottom-2 left-1/2 top-2 z-20 w-[2px] -translate-x-1/2 rounded-full bg-white/80 shadow-[0_0_12px_rgba(255,255,255,0.45)]" />
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-[56px] w-[56px] -translate-x-1/2 -translate-y-1/2 rounded-md border border-white/20" />
          <div className="flex items-center gap-2">
            {trackColors.map((color, index) => (
              <div
                key={`${color}-${index}`}
                className={`h-11 w-11 shrink-0 rounded-md border ${COLOR_THEME[color].tileClass} ${
                  index === CENTER_INDEX ? "ring-2 ring-white/30" : ""
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#293446] bg-[#151d2a] p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#8fa0b8]">Play amount</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-10 min-w-[180px] flex-1 items-center gap-2 rounded-md border border-[#263346] bg-[#101724] px-3">
            <img src="/assets/coin-dino-original.png" alt="coin" className="h-4 w-4 object-contain" />
            <input
              value={playAmountInput}
              onChange={(event) => setPlayAmountInput(event.target.value)}
              className="w-full bg-transparent text-sm font-semibold text-[#ecf2ff] outline-none"
              placeholder="1"
              inputMode="decimal"
            />
          </div>

          <button
            type="button"
            onClick={() => setPlayAmountInput("0")}
            className="h-8 rounded-md border border-[#2d394b] bg-[#111a29] px-2.5 text-xs font-bold text-[#99abc3] hover:bg-[#172133]"
          >
            X
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current + 1)}
            className="h-8 rounded-md border border-[#2d394b] bg-[#111a29] px-2.5 text-xs font-bold text-[#99abc3] hover:bg-[#172133]"
          >
            +1
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current + 10)}
            className="h-8 rounded-md border border-[#2d394b] bg-[#111a29] px-2.5 text-xs font-bold text-[#99abc3] hover:bg-[#172133]"
          >
            +10
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current + 100)}
            className="h-8 rounded-md border border-[#2d394b] bg-[#111a29] px-2.5 text-xs font-bold text-[#99abc3] hover:bg-[#172133]"
          >
            +100
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current + 1000)}
            className="h-8 rounded-md border border-[#2d394b] bg-[#111a29] px-2.5 text-xs font-bold text-[#99abc3] hover:bg-[#172133]"
          >
            +1000
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current / 2)}
            className="h-8 rounded-md border border-[#2d394b] bg-[#111a29] px-2.5 text-xs font-bold text-[#99abc3] hover:bg-[#172133]"
          >
            1/2
          </button>
          <button
            type="button"
            onClick={() => updateAmount((current) => current * 2)}
            className="h-8 rounded-md border border-[#2d394b] bg-[#111a29] px-2.5 text-xs font-bold text-[#99abc3] hover:bg-[#172133]"
          >
            X2
          </button>
          <button
            type="button"
            onClick={() => setPlayAmountInput(String(MAX_PLAY_AMOUNT))}
            className="h-8 rounded-md border border-[#2d394b] bg-[#111a29] px-2.5 text-xs font-bold text-[#99abc3] hover:bg-[#172133]"
          >
            MAX
          </button>
        </div>
        {notice && <p className="mt-2 text-xs font-medium text-[#9fb2cc]">{notice}</p>}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4 md:grid-cols-2">
        {COLOR_ORDER.map((color) => {
          const panel = lastPanels[color];
          const pendingRows = roundEntries
            .filter((entry) => entry.color === color)
            .slice(0, 8)
            .map((entry) => ({ ...entry, net: 0 }));
          const rowsToRender = panel.entries.length > 0 ? panel.entries : pendingRows;
          const netClass = panel.net >= 0 ? "text-[#49d98e]" : "text-[#ff6f6f]";

          return (
            <div key={color} className="rounded-xl border border-[#273345] bg-[#171f2d] p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`h-3.5 w-3.5 rounded-full border ${COLOR_THEME[color].chipClass}`} />
                  <span className={`text-sm font-bold ${COLOR_THEME[color].accentClass}`}>Win {COLOR_THEME[color].multiplier}x</span>
                </div>
                {selectedColor === color && (
                  <span className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-[#c9d8ee]">
                    SELECTED
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => placeBet(color)}
                className={`mb-3 h-9 w-full rounded-md text-xs font-bold tracking-[0.08em] text-white transition-colors ${
                  COLOR_THEME[color].actionClass
                }`}
              >
                PLAY
              </button>

              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-[#90a4bf]">{panel.plays} Plays</span>
                <span className={`font-semibold ${netClass}`}>{formatSignedAmount(panel.net)}</span>
              </div>

              <div className="max-h-[210px] space-y-1 overflow-auto pr-1">
                {rowsToRender.length === 0 ? (
                  <p className="text-xs text-[#70829b]">No plays yet.</p>
                ) : (
                  rowsToRender.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between rounded-md bg-[#111926] px-2 py-1.5 text-xs">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                            entry.isUser ? "bg-[#2d4f90] text-[#dce9ff]" : "bg-[#273245] text-[#9eb2cf]"
                          }`}
                        >
                          {entry.userLabel.charAt(0).toUpperCase()}
                        </span>
                        <span className={`truncate ${entry.isUser ? "text-[#dce9ff]" : "text-[#95a9c7]"}`}>{entry.userLabel}</span>
                      </div>
                      <span className={entry.net === 0 ? "text-[#dbebff]" : entry.net > 0 ? "text-[#49d98e]" : "text-[#ff6f6f]"}>
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
