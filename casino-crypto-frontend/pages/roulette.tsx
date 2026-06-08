import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCurrentRouletteBetBreakdown,
  getCurrentRound,
  getRouletteBetBreakdownByRoundId,
  getRouletteResults,
  getWallets,
  placeRouletteBet,
  type RouletteBetBreakdown,
  type RouletteRound,
  type Wallet
} from "@/lib/api";
import { CasinoSocket, type SocketEvent } from "@/lib/socket";
import { refreshBalance } from "@/lib/refreshBalance";
import { useToast } from "@/lib/toast";

type BetColor = "RED" | "GREEN" | "BLACK" | "BAIT";
type BaseColor = "RED" | "GREEN" | "BLACK";
type WheelSlotKind = "RED" | "BLACK" | "GREEN" | "BAIT_RED" | "BAIT_BLACK";

type WheelSlot = {
  number: number;
  kind: WheelSlotKind;
  color: BaseColor;
  isBait: boolean;
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

const CURRENCY = "USDT";
const BET_ORDER: BetColor[] = ["RED", "GREEN", "BLACK", "BAIT"];
const HISTORY_STORAGE_KEY = "roulette-color-history-v4";
const SPIN_TRANSLATE_STORAGE_KEY = "roulette-spin-translate-v1";
const MIN_BET_COINS = 0.1;
const MAX_BET_COINS = 5_000;
const COIN_DECIMALS = 1e8;

const SLOT_SIZE = 68;
const SLOT_GAP = 9;
const SLOT_STRIDE = SLOT_SIZE + SLOT_GAP;
const CONTINUOUS_SPIN_SPEED = 1080; // px/s

// Alternating red/black pattern with BAIT on both sides of green.
const WHEEL_LAYOUT: WheelSlot[] = [
  { number: 2, kind: "BLACK", color: "BLACK", isBait: false },
  { number: 3, kind: "RED", color: "RED", isBait: false },
  { number: 4, kind: "BLACK", color: "BLACK", isBait: false },
  { number: 5, kind: "RED", color: "RED", isBait: false },
  { number: 6, kind: "BLACK", color: "BLACK", isBait: false },
  { number: 7, kind: "RED", color: "RED", isBait: false },
  { number: 14, kind: "BAIT_RED", color: "RED", isBait: true },
  { number: 0, kind: "GREEN", color: "GREEN", isBait: false },
  { number: 1, kind: "BAIT_BLACK", color: "BLACK", isBait: true },
  { number: 8, kind: "BLACK", color: "BLACK", isBait: false },
  { number: 9, kind: "RED", color: "RED", isBait: false },
  { number: 10, kind: "BLACK", color: "BLACK", isBait: false },
  { number: 11, kind: "RED", color: "RED", isBait: false },
  { number: 12, kind: "BLACK", color: "BLACK", isBait: false },
  { number: 13, kind: "RED", color: "RED", isBait: false }
];
const WHEEL_LENGTH = WHEEL_LAYOUT.length;

const NUMBER_TO_LAYOUT_INDEX = WHEEL_LAYOUT.reduce<Record<number, number>>((acc, slot, index) => {
  acc[slot.number] = index;
  return acc;
}, {});

const BET_THEME: Record<
  BetColor,
  { label: string; multiplier: number; chipClass: string; accentClass: string; actionClass: string }
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

const mod = (value: number, size: number): number => ((value % size) + size) % size;
const randomId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const atomicToCoins = (atomic: string): number => {
  const value = Number(atomic);
  if (!Number.isFinite(value)) return 0;
  return value / COIN_DECIMALS;
};

const coinsToAtomicString = (coins: number): string => {
  const scaled = Math.round(Math.max(0, coins) * COIN_DECIMALS);
  return String(BigInt(scaled));
};

const formatAmount = (value: number): string =>
  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatSignedAmount = (value: number): string => `${value >= 0 ? "+" : ""}${formatAmount(value)}`;
const toMinutesSeconds = (value: number): string => `00:${String(Math.max(0, value)).padStart(2, "0")}`;
const CYCLE_WIDTH = WHEEL_LENGTH * SLOT_STRIDE;
const TRACK_REPEATS = 120;
const TRACK_SLOT_COUNT = TRACK_REPEATS * WHEEL_LENGTH;
const TRACK_SLOTS: WheelSlot[] = Array.from({ length: TRACK_SLOT_COUNT }, (_, index) => WHEEL_LAYOUT[index % WHEEL_LENGTH]);
const TRACK_WIDTH = TRACK_SLOT_COUNT * SLOT_STRIDE;
const INITIAL_TRANSLATE = CYCLE_WIDTH * 30;

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

const slotByWinningNumber = (winningNumber: number): WheelSlot =>
  WHEEL_LAYOUT[NUMBER_TO_LAYOUT_INDEX[winningNumber] ?? NUMBER_TO_LAYOUT_INDEX[0]];

const emptyPanels = (): Record<BetColor, ColorPanel> => ({
  RED: { plays: 0, net: 0, entries: [] },
  GREEN: { plays: 0, net: 0, entries: [] },
  BLACK: { plays: 0, net: 0, entries: [] },
  BAIT: { plays: 0, net: 0, entries: [] }
});

const parseCoinsValue = (value?: string): number | null => {
  if (!value) return null;
  const normalized = value.replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const walletAvailableCoins = (wallet: Wallet): number => {
  const availableCoins = parseCoinsValue(wallet.availableCoins);
  if (availableCoins !== null) {
    return Math.max(0, availableCoins);
  }

  if (wallet.availableAtomic && Number.isFinite(Number(wallet.availableAtomic))) {
    return Math.max(0, atomicToCoins(wallet.availableAtomic));
  }

  const balanceCoins = parseCoinsValue(wallet.balanceCoins);
  const lockedCoins = parseCoinsValue(wallet.lockedCoins) ?? 0;
  if (balanceCoins !== null) {
    return Math.max(0, balanceCoins - lockedCoins);
  }

  try {
    const balance = BigInt(wallet.balanceAtomic);
    const locked = BigInt(wallet.lockedAtomic);
    return Math.max(0, Number(balance - locked) / COIN_DECIMALS);
  } catch {
    return 0;
  }
};

const walletBalanceCoins = (wallet: Wallet): number => {
  const balanceCoins = parseCoinsValue(wallet.balanceCoins);
  if (balanceCoins !== null) {
    return Math.max(0, balanceCoins);
  }

  if (wallet.balanceAtomic && Number.isFinite(Number(wallet.balanceAtomic))) {
    return Math.max(0, atomicToCoins(wallet.balanceAtomic));
  }

  return walletAvailableCoins(wallet);
};

const findWalletByCurrency = (wallets: Wallet[], currency: string): Wallet | undefined =>
  wallets.find((wallet) => wallet.currency.toUpperCase() === currency.toUpperCase());

const pickPrimaryRouletteWallet = (wallets: Wallet[]): Wallet | undefined => {
  if (wallets.length === 0) return undefined;
  const coinsWallet = findWalletByCurrency(wallets, "COINS");
  if (coinsWallet) return coinsWallet;
  return wallets[0];
};

const formatCoinsInput = (value: number): string => {
  const normalized = Math.max(0, value);
  return normalized.toFixed(8).replace(/\.?0+$/, "") || "0";
};

const buildPanelsFromBreakdown = (
  breakdown: RouletteBetBreakdown | null,
  winner: WheelSlot | null
): Record<BetColor, ColorPanel> => {
  const panels = emptyPanels();
  if (!breakdown) return panels;

  for (const color of BET_ORDER) {
    const rows = breakdown.entriesByType[color];
    const entries: SettledEntry[] = rows.map((row) => {
      const amount = atomicToCoins(row.stakeAtomic);
      const net = winner ? (didBetWin(color, winner) ? amount * (BET_THEME[color].multiplier - 1) : -amount) : 0;
      return {
        id: `${color}-${row.userId}-${row.stakeAtomic}-${randomId()}`,
        userLabel: row.userLabel,
        color,
        amount,
        isUser: false,
        net
      };
    });

    panels[color].entries = entries.slice(0, 8);
    panels[color].plays = rows.length;
    panels[color].net = entries.reduce((acc, entry) => acc + entry.net, 0);
  }

  return panels;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const readStoredSpinTranslate = (): number => {
  if (typeof window === "undefined") return INITIAL_TRANSLATE;
  try {
    const raw = window.localStorage.getItem(SPIN_TRANSLATE_STORAGE_KEY);
    if (!raw) return INITIAL_TRANSLATE;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return INITIAL_TRANSLATE;
    return Math.max(0, Math.min(TRACK_WIDTH - SLOT_STRIDE, parsed));
  } catch {
    return INITIAL_TRANSLATE;
  }
};

const persistSpinTranslate = (value: number): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SPIN_TRANSLATE_STORAGE_KEY, String(value));
  } catch {
    // Ignore storage failures.
  }
};

const normalizeTranslate = (value: number, laneWidth: number): number => {
  let next = value;
  const min = CYCLE_WIDTH * 8;
  const max = Math.max(min + CYCLE_WIDTH, TRACK_WIDTH - laneWidth - CYCLE_WIDTH * 8);
  const shift = CYCLE_WIDTH * 20;
  while (next > max) next -= shift;
  while (next < min) next += shift;
  return next;
};

const getActiveRepeatedIndex = (translate: number, pointerPx: number): number => {
  const approx = clamp(Math.floor((translate + pointerPx) / SLOT_STRIDE), 0, TRACK_SLOT_COUNT - 1);
  let hitIndex: number | null = null;
  let bestIndex = approx;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = approx - 3; index <= approx + 3; index += 1) {
    if (index < 0 || index >= TRACK_SLOT_COUNT) continue;
    const left = index * SLOT_STRIDE - translate;
    if (pointerPx >= left && pointerPx <= left + SLOT_SIZE) {
      hitIndex = index;
      break;
    }
    const centerX = left + SLOT_SIZE / 2;
    const distance = Math.abs(centerX - pointerPx);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return hitIndex ?? bestIndex;
};

const getSettleMix = (progress: number, startSlope: number): number => {
  const t = clamp(progress, 0, 1);
  // Cubic with C1 continuity: starts at current lane speed, ends with zero speed.
  const k = clamp(startSlope, 0.8, 2.4);
  const a = k - 2;
  const b = 3 - 2 * k;
  return a * t * t * t + b * t * t + k * t;
};

export default function RoulettePage() {
  const toast = useToast();
  const laneRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const availableCoinsRef = useRef<number | null>(null);
  const previousRoundRef = useRef<{ id: string | null; status: string | null }>({ id: null, status: null });
  const handledSettledRoundRef = useRef<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const [round, setRound] = useState<RouletteRound | null>(null);
  const [breakdown, setBreakdown] = useState<RouletteBetBreakdown | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [playAmountInput, setPlayAmountInput] = useState("1");
  const [placing, setPlacing] = useState(false);
  const [availableCoins, setAvailableCoins] = useState<number | null>(null);
  const [laneWidth, setLaneWidth] = useState(960);
  const [spinTranslate, setSpinTranslate] = useState(() => readStoredSpinTranslate());
  const [isVisualSpinning, setIsVisualSpinning] = useState(false);
  const [revealedWinnerRoundId, setRevealedWinnerRoundId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [flashPanels, setFlashPanels] = useState<Record<BetColor, ColorPanel> | null>(null);

  const spinTranslateRef = useRef(spinTranslate);
  useEffect(() => {
    spinTranslateRef.current = spinTranslate;
  }, [spinTranslate]);
  useEffect(() => {
    availableCoinsRef.current = availableCoins;
  }, [availableCoins]);

  useEffect(
    () => () => {
      persistSpinTranslate(spinTranslateRef.current);
    },
    []
  );

  const clearRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const clearFlash = useCallback(() => {
    setFlashPanels(null);
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
  }, []);

  const loadWalletBalance = useCallback(async (): Promise<number | null> => {
    try {
      const wallets = await getWallets();
      const primary = pickPrimaryRouletteWallet(wallets);
      if (primary) {
        const next = walletBalanceCoins(primary);
        availableCoinsRef.current = next;
        setAvailableCoins(next);
        return next;
      }
    } catch {
      // Keep last known value on transient errors.
    }
    return availableCoinsRef.current ?? null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [currentRound, currentBreakdown, recentResults] = await Promise.all([
          getCurrentRound(CURRENCY),
          getCurrentRouletteBetBreakdown(CURRENCY),
          getRouletteResults(CURRENCY, 20)
        ]);
        if (cancelled) return;
        setRound(currentRound);
        setBreakdown(currentBreakdown);

        const serverHistory = recentResults.map((row) => toHistoryEntry(slotByWinningNumber(row.winningNumber)));
        let storedHistory: HistoryEntry[] = [];
        if (typeof window !== "undefined") {
          try {
            const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw) as unknown;
              if (Array.isArray(parsed)) {
                storedHistory = parsed.filter(isHistoryEntry).slice(0, 100);
              }
            }
          } catch {
            storedHistory = [];
          }
        }
        setHistory([...serverHistory, ...storedHistory].slice(0, 100));
      } catch {
        // Ignore bootstrap fetch errors and rely on websocket updates.
      }
      await loadWalletBalance();
    };
    void load();

    const socket = new CasinoSocket(CURRENCY);
    socket.subscribe((event: SocketEvent) => {
      if (event.type === "roulette.round") {
        setRound({
          id: event.data.roundId,
          roundNumber: event.data.roundNumber,
          currency: event.data.currency,
          status: event.data.status,
          openAt: event.data.openAt,
          betsCloseAt: event.data.betsCloseAt,
          spinStartsAt: event.data.spinStartsAt,
          settleAt: event.data.settleAt,
          winningNumber: event.data.winningNumber,
          winningColor: event.data.winningColor,
          totalStakedAtomic: event.data.totalStakedAtomic,
          totalPayoutAtomic: event.data.totalPayoutAtomic
        });
      } else if (event.type === "roulette.betBreakdown") {
        setBreakdown(event.data);
      }
    });
    socket.connect();

    return () => {
      cancelled = true;
      socket.disconnect();
      clearRaf();
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
    };
  }, [clearRaf, loadWalletBalance]);

  useEffect(() => {
    if (!laneRef.current || typeof ResizeObserver === "undefined") return;
    const element = laneRef.current;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setLaneWidth(Math.max(420, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || history.length === 0) return;
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 100)));
  }, [history]);

  const startContinuousSpin = useCallback(() => {
    clearRaf();
    setIsVisualSpinning(true);
    let lastTs = performance.now();

    const tick = (ts: number) => {
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;
      const raw = spinTranslateRef.current + CONTINUOUS_SPIN_SPEED * dt;
      const next = normalizeTranslate(raw, laneWidth);
      spinTranslateRef.current = next;
      setSpinTranslate(next);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [clearRaf, laneWidth]);

  const stopSpinAtWinningNumber = useCallback(
    (winningNumber: number, onComplete?: () => void) => {
      clearRaf();
      setIsVisualSpinning(true);

      const pointerPx = laneWidth * 0.5;
      let startPhase = normalizeTranslate(spinTranslateRef.current, laneWidth);
      const currentRepeatedIndex = getActiveRepeatedIndex(startPhase, pointerPx);
      const currentLayout = mod(currentRepeatedIndex, WHEEL_LENGTH);
      const winnerLayout = NUMBER_TO_LAYOUT_INDEX[winningNumber] ?? NUMBER_TO_LAYOUT_INDEX[0];
      const stepsToWinner = mod(winnerLayout - currentLayout, WHEEL_LENGTH);
      const extraLoops = WHEEL_LENGTH * (1 + Math.floor(Math.random() * 2));
      const targetRepeatedIndex = currentRepeatedIndex + stepsToWinner + extraLoops;
      const durationMs = 3600;
      const startedAt = performance.now();
      const landingOffset = SLOT_SIZE * (0.18 + Math.random() * 0.64);
      let endPhase = targetRepeatedIndex * SLOT_STRIDE + landingOffset - pointerPx;

      while (endPhase > TRACK_WIDTH - laneWidth - CYCLE_WIDTH * 4) {
        startPhase -= CYCLE_WIDTH * 20;
        endPhase -= CYCLE_WIDTH * 20;
      }
      if (startPhase !== spinTranslateRef.current) {
        spinTranslateRef.current = startPhase;
        setSpinTranslate(startPhase);
      }
      const travelDistance = Math.max(1, endPhase - startPhase);
      const startSlope = (CONTINUOUS_SPIN_SPEED * (durationMs / 1000)) / travelDistance;

      const tick = (ts: number) => {
        const progress = Math.max(0, Math.min(1, (ts - startedAt) / durationMs));
        const mix = getSettleMix(progress, startSlope);
        const next = startPhase + (endPhase - startPhase) * mix;
        spinTranslateRef.current = next;
        setSpinTranslate(next);

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        spinTranslateRef.current = endPhase;
        setSpinTranslate(endPhase);
        setIsVisualSpinning(false);
        onComplete?.();
        rafRef.current = null;
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [clearRaf, laneWidth]
  );

  useEffect(() => {
    if (!round) return;
    const previous = previousRoundRef.current;
    const status = round.status;

    if (status === "SPINNING" && (previous.id !== round.id || previous.status !== "SPINNING")) {
      startContinuousSpin();
    }

    if (status === "SETTLED" && round.winningNumber !== null && handledSettledRoundRef.current !== round.id) {
      handledSettledRoundRef.current = round.id;
      setRevealedWinnerRoundId(null);

      const winnerSlot = slotByWinningNumber(round.winningNumber);
      stopSpinAtWinningNumber(round.winningNumber, () => {
        persistSpinTranslate(spinTranslateRef.current);
        setRevealedWinnerRoundId(round.id);
        setHistory((current) => [toHistoryEntry(winnerSlot), ...current].slice(0, 100));
        void loadWalletBalance();
        refreshBalance();

        void (async () => {
          try {
            const settledBreakdown = await getRouletteBetBreakdownByRoundId(round.id);
            setFlashPanels(buildPanelsFromBreakdown(settledBreakdown, winnerSlot));
            if (flashTimerRef.current !== null) {
              window.clearTimeout(flashTimerRef.current);
            }
            flashTimerRef.current = window.setTimeout(() => setFlashPanels(null), 3000);
          } catch {
            // Ignore missing settled breakdown.
          }
        })();
      });
    }

    if (status === "OPEN" && previous.status && previous.status !== "OPEN") {
      clearFlash();
      setRevealedWinnerRoundId(null);
      handledSettledRoundRef.current = null;
    }

    previousRoundRef.current = { id: round.id, status };
  }, [clearFlash, isVisualSpinning, loadWalletBalance, round, startContinuousSpin, stopSpinAtWinningNumber]);

  const currentAmount = useMemo(() => {
    const normalized = Number(playAmountInput.replace(",", "."));
    if (!Number.isFinite(normalized)) return 0;
    return Math.max(0, normalized);
  }, [playAmountInput]);

  const maxBetByBalance = Math.min(MAX_BET_COINS, Math.max(0, availableCoins ?? 0));

  const nextSpinSeconds = useMemo(() => {
    if (!round) return 0;
    if (round.status === "SPINNING") return 0;
    const now = nowMs;
    let target = now;
    if (round.status === "OPEN" || round.status === "CLOSED") {
      target = Date.parse(round.spinStartsAt);
    }
    if (round.status === "SETTLED") {
      return 0;
    }
    return Math.max(0, Math.ceil((target - now) / 1000));
  }, [nowMs, round]);

  const shouldKeepSpinUi = useMemo(() => {
    if (!round) return isVisualSpinning;
    const waitingReveal =
      round.status === "SETTLED" && round.winningNumber !== null && revealedWinnerRoundId !== round.id;
    return isVisualSpinning || round.status === "SPINNING" || waitingReveal;
  }, [isVisualSpinning, revealedWinnerRoundId, round]);
  const canBetNow = !!round && round.status === "OPEN" && !shouldKeepSpinUi && !placing;

  const statusText = useMemo(() => {
    if (!round) return "Waiting for next spin";
    if (shouldKeepSpinUi) return "Spinning...";
    if (round.status === "CLOSED") return "Bets closed";
    if (round.status === "SETTLED" && round.winningNumber !== null) {
      if (revealedWinnerRoundId === round.id) {
        return getWinnerLabel(slotByWinningNumber(round.winningNumber));
      }
      return "Spinning...";
    }
    return "Waiting for next spin";
  }, [revealedWinnerRoundId, round, shouldKeepSpinUi]);

  const pointerPx = laneWidth * 0.5;
  const activeSlotKey = useMemo(() => getActiveRepeatedIndex(spinTranslate, pointerPx), [pointerPx, spinTranslate]);

  const updateAmount = (updater: (current: number) => number) => {
    const next = Math.min(MAX_BET_COINS, Math.max(0, Math.round(updater(currentAmount) * 100) / 100));
    setPlayAmountInput(formatCoinsInput(next));
  };

  const placeBet = async (color: BetColor) => {
    if (!canBetNow) {
      return;
    }
    if (!Number.isFinite(currentAmount) || currentAmount < MIN_BET_COINS) {
      toast.showError("Minimum roulette bet is 0.10 COINS.");
      return;
    }
    if (currentAmount > MAX_BET_COINS) {
      toast.showError("You can't bet more than 5000 COINS.");
      return;
    }
    setPlacing(true);
    try {
      const response = await placeRouletteBet(CURRENCY, color, coinsToAtomicString(currentAmount));
      setRound(response.round);
      if (response.wallet?.availableAtomic) {
        const next = atomicToCoins(response.wallet.availableAtomic);
        availableCoinsRef.current = next;
        setAvailableCoins(next);
      } else {
        await loadWalletBalance();
      }
      const latestBreakdown = await getCurrentRouletteBetBreakdown(CURRENCY);
      setBreakdown(latestBreakdown);
      refreshBalance();
      toast.showSuccess(`Bet placed on ${BET_THEME[color].label}.`);
    } catch {
      // API layer already emits global error toast.
    } finally {
      setPlacing(false);
    }
  };

  const livePanels = useMemo(() => buildPanelsFromBreakdown(breakdown, null), [breakdown]);
  const showingFlash = flashPanels !== null;
  const displayedPanels = flashPanels ?? livePanels;

  const applyMaxBet = async () => {
    const refreshed = await loadWalletBalance();
    const base = refreshed ?? availableCoinsRef.current ?? availableCoins ?? 0;
    const capped = Math.min(MAX_BET_COINS, Math.max(0, base));
    setPlayAmountInput(formatCoinsInput(capped));
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
              <span className={`h-4 w-4 rounded-full border ${BET_THEME[color].chipClass}`} />
              <span>{historyCount[color]}</span>
            </div>
          ))}
        </div>
        <div
          className="grid gap-2"
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
          <p className="text-sm font-medium text-[#d5d8de]">{statusText}</p>
          <div className="rounded-lg border border-[#3a3d45] bg-[#16181d] px-3 py-2 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9a9ea8]">Next spin</p>
            <p className="font-mono text-lg font-bold text-[#f2f3f6]">
              {shouldKeepSpinUi ? "--:--" : toMinutesSeconds(nextSpinSeconds)}
            </p>
          </div>
        </div>

        <div ref={laneRef} className="relative overflow-hidden rounded-xl border border-[#30343c] bg-[#15171b] py-4">
          <div className="pointer-events-none absolute bottom-2 left-1/2 top-2 z-30 w-[2px] -translate-x-1/2 rounded-full bg-white/85 shadow-[0_0_14px_rgba(255,255,255,0.35)]" />

          <div className="relative h-[68px]">
            <div
              className="absolute left-0 top-0 flex"
              style={{
                width: TRACK_WIDTH,
                gap: `${SLOT_GAP}px`,
                transform: `translate3d(${-spinTranslate}px, 0, 0)`,
                willChange: "transform"
              }}
            >
              {TRACK_SLOTS.map((slot, repeatedIndex) => {
                const isActive = repeatedIndex === activeSlotKey;
                return (
                  <div
                    key={`${repeatedIndex}-${slot.number}`}
                    className={`relative rounded-md border transition-all duration-100 ${getTileClass(slot)} ${
                      isActive ? "z-20 scale-[1.08] opacity-100 brightness-125 shadow-[0_0_24px_rgba(255,255,255,0.24)]" : "opacity-35"
                    }`}
                    style={{ width: SLOT_SIZE, height: SLOT_SIZE, flex: "0 0 auto" }}
                  >
                    {slot.isBait && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#ebcf7f]" />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#2f323a] bg-[#1b1d22] p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#9da2ac]">Play amount</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-10 min-w-[180px] flex-1 items-center gap-2 rounded-md border border-[#353941] bg-[#16191e] px-3">
            <img src="/assets/coin-dino-original.png" alt="coin" className="h-7 w-7 object-contain" />
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
            onClick={() => updateAmount((value) => value + 1)}
            className="h-8 rounded-md border border-[#595d67] bg-[#2a2f39] px-2.5 text-xs font-bold text-[#e1e4ea] shadow-[0_0_10px_rgba(255,255,255,0.12)] hover:bg-[#363c48]"
          >
            +1
          </button>
          <button
            type="button"
            onClick={() => updateAmount((value) => value + 10)}
            className="h-8 rounded-md border border-[#595d67] bg-[#2a2f39] px-2.5 text-xs font-bold text-[#e1e4ea] shadow-[0_0_10px_rgba(255,255,255,0.12)] hover:bg-[#363c48]"
          >
            +10
          </button>
          <button
            type="button"
            onClick={() => updateAmount((value) => value + 100)}
            className="h-8 rounded-md border border-[#595d67] bg-[#2a2f39] px-2.5 text-xs font-bold text-[#e1e4ea] shadow-[0_0_10px_rgba(255,255,255,0.12)] hover:bg-[#363c48]"
          >
            +100
          </button>
          <button
            type="button"
            onClick={() => updateAmount((value) => value + 1000)}
            className="h-8 rounded-md border border-[#595d67] bg-[#2a2f39] px-2.5 text-xs font-bold text-[#e1e4ea] shadow-[0_0_10px_rgba(255,255,255,0.12)] hover:bg-[#363c48]"
          >
            +1000
          </button>
          <button
            type="button"
            onClick={() => updateAmount((value) => value / 2)}
            className="h-8 rounded-md border border-[#595d67] bg-[#2a2f39] px-2.5 text-xs font-bold text-[#e1e4ea] shadow-[0_0_10px_rgba(255,255,255,0.12)] hover:bg-[#363c48]"
          >
            1/2
          </button>
          <button
            type="button"
            onClick={() => updateAmount((value) => value * 2)}
            className="h-8 rounded-md border border-[#595d67] bg-[#2a2f39] px-2.5 text-xs font-bold text-[#e1e4ea] shadow-[0_0_10px_rgba(255,255,255,0.12)] hover:bg-[#363c48]"
          >
            X2
          </button>
          <button
            type="button"
            onClick={() => void applyMaxBet()}
            className="h-8 rounded-md border border-[#595d67] bg-[#2a2f39] px-2.5 text-xs font-bold text-[#e1e4ea] shadow-[0_0_10px_rgba(255,255,255,0.12)] hover:bg-[#363c48]"
          >
            MAX
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {BET_ORDER.map((color) => {
          const panel = displayedPanels[color];
          const shouldShowNet = showingFlash && panel.plays > 0;
          const headerValue = shouldShowNet ? formatSignedAmount(panel.net) : null;
          const headerClass = panel.net >= 0 ? "text-[#56d58f]" : "text-[#ff8080]";

          return (
            <div key={color} className="rounded-xl border border-[#33363f] bg-[#1b1d22] p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`h-5 w-5 rounded-full border ${BET_THEME[color].chipClass}`} />
                  <span className={`text-sm font-bold ${BET_THEME[color].accentClass}`}>Win {BET_THEME[color].multiplier}x</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void placeBet(color)}
                disabled={!canBetNow}
                className={`mb-3 h-10 w-full rounded-md text-xs font-extrabold tracking-[0.1em] text-white transition-all disabled:opacity-60 ${
                  BET_THEME[color].actionClass
                }`}
              >
                {placing ? "PLACING..." : "PLAY"}
              </button>

              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-[#a2a7b0]">{panel.plays} Plays</span>
                {headerValue ? <span className={`font-semibold ${headerClass}`}>{headerValue}</span> : <span />}
              </div>

              <div className="max-h-[210px] space-y-1 overflow-auto pr-1">
                {panel.entries.length === 0 ? (
                  <p className="text-xs text-[#8b8f98]">No plays yet.</p>
                ) : (
                  panel.entries.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between rounded-md bg-[#15181d] px-2 py-1.5 text-xs">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#464b55] text-[9px] font-bold text-[#f0f2f5]">
                          {entry.userLabel.charAt(0).toUpperCase()}
                        </span>
                        <span className="truncate text-[#eceef2]">{entry.userLabel}</span>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 ${
                          showingFlash ? (entry.net >= 0 ? "text-[#56d58f]" : "text-[#ff8080]") : "text-[#d6d9de]"
                        }`}
                      >
                        <img src="/assets/coin-dino-original.png" alt="coin" className="h-6 w-6 object-contain" />
                        <span>{showingFlash ? formatSignedAmount(entry.net) : formatAmount(entry.amount)}</span>
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
