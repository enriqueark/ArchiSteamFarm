import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/Button";
import Card from "@/components/Card";
import Input from "@/components/Input";
import {
  getCurrentRouletteBetBreakdown,
  getCurrentRound,
  getRouletteRecentResults,
  getAccessToken,
  placeRouletteBet,
  type RouletteBetBreakdown,
  type RouletteResultHistoryItem,
  type RouletteRound
} from "@/lib/api";
import { CasinoSocket, type BetBreakdownEvent, type RouletteRoundEvent, type SocketEvent } from "@/lib/socket";
import { useAuthUI } from "@/lib/auth-ui";

const INTERNAL_GAME_CURRENCY = "USDT";
const VIRTUAL_CURRENCY_LABEL = "COINS";
const COIN_DECIMALS = 8;

const BET_TYPES = ["RED", "BLACK", "GREEN", "BAIT"] as const;
type BetType = (typeof BET_TYPES)[number];

const BET_CONFIG: Record<
  BetType,
  { label: string; payoutLabel: string; accent: string; buttonVariant: "red" | "black" | "green" | "primary" }
> = {
  RED: { label: "RED", payoutLabel: "Win 2x", accent: "text-red-400", buttonVariant: "red" },
  BLACK: { label: "BLACK", payoutLabel: "Win 2x", accent: "text-gray-200", buttonVariant: "black" },
  GREEN: { label: "GREEN", payoutLabel: "Win 14x", accent: "text-green-400", buttonVariant: "green" },
  BAIT: { label: "BAIT", payoutLabel: "Win 7x", accent: "text-indigo-300", buttonVariant: "primary" }
};

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 11, 13]);
const WHEEL_SEQUENCE = [14, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const WHEEL_VISIBLE_SLOTS = 17;
const WHEEL_CENTER_SLOT = Math.floor(WHEEL_VISIBLE_SLOTS / 2);
const WHEEL_TRACK_SIDE_BUFFER = 3;
const WHEEL_FAST_STEPS_PER_SECOND = 18;
const WHEEL_SLOW_STEPS_PER_SECOND = 0.35;
const COUNTDOWN_TICK_MS = 50;

const COINS_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const mod = (value: number, length: number): number => ((value % length) + length) % length;
const modFloat = (value: number, length: number): number => ((value % length) + length) % length;
const easeOutCubic = (value: number): number => 1 - (1 - value) ** 3;
const formatSecondsWithMilliseconds = (remainingMs: number): string => {
  const safeMs = Math.max(0, remainingMs);
  const wholeSeconds = Math.floor(safeMs / 1000);
  const milliseconds = Math.floor(safeMs % 1000)
    .toString()
    .padStart(3, "0");
  return `${wholeSeconds}.${milliseconds}s`;
};

const getNumberColor = (n: number): "GREEN" | "RED" | "BLACK" => {
  if (n === 0) {
    return "GREEN";
  }

  return RED_NUMBERS.has(n) ? "RED" : "BLACK";
};

const toCoinsNumber = (atomic: string): number => {
  const value = Number(atomic);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value / 10 ** COIN_DECIMALS;
};

const formatCoins = (value: number): string => `${COINS_FORMATTER.format(value)} ${VIRTUAL_CURRENCY_LABEL}`;

const formatSignedAtomicAsCoins = (atomic: string): string => {
  const coins = toCoinsNumber(atomic);
  const sign = coins >= 0 ? "+" : "-";
  return `${sign}${formatCoins(Math.abs(coins))}`;
};

const coinsToAtomicString = (coinsRaw: string): string => {
  const coins = Number(coinsRaw);
  if (!Number.isFinite(coins) || coins <= 0) {
    throw new Error("Stake must be a positive COINS value");
  }

  const atomic = Math.round(coins * 10 ** COIN_DECIMALS);
  if (!Number.isFinite(atomic) || atomic <= 0) {
    throw new Error("Stake is too low");
  }

  return String(atomic);
};

export default function RoulettePage() {
  const { authed, openAuth } = useAuthUI();
  const [round, setRound] = useState<RouletteRound | RouletteRoundEvent | null>(null);
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [stakeCoins, setStakeCoins] = useState("10.00");
  const [betType, setBetType] = useState<BetType>("RED");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState<string>("");
  const [history, setHistory] = useState<RouletteResultHistoryItem[]>([]);
  const [betBreakdown, setBetBreakdown] = useState<RouletteBetBreakdown | null>(null);
  const [wheelIndex, setWheelIndex] = useState(0);
  const [pointerOffsetPx, setPointerOffsetPx] = useState(0);
  const [slotWidthPx, setSlotWidthPx] = useState(0);
  const [settlementSummary, setSettlementSummary] = useState<
    | {
        roundNumber: number;
        winningNumber: number;
        winningColor: string;
        outcomes: Array<{ userId: string; userLabel: string; netAtomic: string }>;
      }
    | null
  >(null);

  const socketRef = useRef<CasinoSocket | null>(null);
  const wheelGridRef = useRef<HTMLDivElement | null>(null);
  const settlementHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerOffsetRef = useRef(0);
  const wheelIndexRef = useRef(0);
  const wheelSpinRafRef = useRef<number | null>(null);
  const lastRoundIdRef = useRef<string | null>(null);
  const completedRoundIdRef = useRef<string | null>(null);
  const spinPlanRef = useRef<{
    roundKey: string;
    spinStartsAtMs: number;
    settleAtMs: number;
    startContinuous: number;
    totalSteps: number;
    targetContinuous: number;
    winningNumber: number | null;
  } | null>(null);
  const pendingHistoryByRoundIdRef = useRef<Map<string, RouletteResultHistoryItem>>(new Map());

  const setWheelIndexSafe = useCallback((nextValue: number) => {
    const normalized = mod(nextValue, WHEEL_SEQUENCE.length);
    wheelIndexRef.current = normalized;
    setWheelIndex(normalized);
  }, []);

  const setPointerOffsetSafe = useCallback((nextOffsetPx: number, force = false) => {
    if (!force && Math.abs(nextOffsetPx - pointerOffsetRef.current) < 0.05) {
      return;
    }
    pointerOffsetRef.current = nextOffsetPx;
    setPointerOffsetPx(nextOffsetPx);
  }, []);

  const stopWheelSpinAnimation = useCallback(() => {
    if (wheelSpinRafRef.current !== null) {
      cancelAnimationFrame(wheelSpinRafRef.current);
      wheelSpinRafRef.current = null;
    }
    spinPlanRef.current = null;
  }, []);

  const flushPendingHistoryForRound = useCallback((roundId: string) => {
    const item = pendingHistoryByRoundIdRef.current.get(roundId);
    if (!item) {
      return;
    }
    pendingHistoryByRoundIdRef.current.delete(roundId);
    setHistory((prev) => [item, ...prev.filter((existing) => existing.roundId !== item.roundId)].slice(0, 20));
  }, []);

  const startWheelSpinAnimation = useCallback(
    (roundKey: string, spinStartsAtMs: number, settleAtMs: number, winningNumber: number | null) => {
      if (completedRoundIdRef.current === roundKey) {
        return;
      }
      if (wheelSpinRafRef.current !== null && spinPlanRef.current?.roundKey === roundKey) {
        return;
      }
      if (wheelSpinRafRef.current !== null) {
        stopWheelSpinAnimation();
      }

      const slotPx = Math.max(1, slotWidthPx);
      const startFractionRaw = pointerOffsetRef.current / slotPx;
      const normalizedStartOffsetSteps = modFloat(startFractionRaw, 1);
      const startContinuous = wheelIndexRef.current + normalizedStartOffsetSteps;
      const durationMs = Math.max(1, settleAtMs - spinStartsAtMs);

      let totalSteps = Math.max(6, Math.floor(durationMs / 130)) * WHEEL_SEQUENCE.length;
      let targetContinuous = startContinuous + totalSteps;
      if (typeof winningNumber === "number") {
        const targetIndex = WHEEL_SEQUENCE.indexOf(winningNumber);
        if (targetIndex >= 0) {
          const plannedLoops = Math.max(9, Math.floor(durationMs / 700));
          const forwardDistance = modFloat(targetIndex - startContinuous, WHEEL_SEQUENCE.length);
          totalSteps = forwardDistance + plannedLoops * WHEEL_SEQUENCE.length;
          // Natural landing: random pointer position inside the winning slot.
          // Most rounds can finish near center, some near edges.
          const edgeBias = 0.44;
          const centerBias = 0.12;
          const shouldEdgeLand = Math.random() < 0.55;
          const edgeOffset = shouldEdgeLand
            ? (Math.random() < 0.5 ? -edgeBias : edgeBias)
            : (Math.random() * 2 - 1) * centerBias;
          targetContinuous = startContinuous + totalSteps + edgeOffset;
        }
      }

      spinPlanRef.current = {
        roundKey,
        spinStartsAtMs,
        settleAtMs,
        startContinuous,
        totalSteps,
        targetContinuous,
        winningNumber
      };

      const tick = () => {
        const plan = spinPlanRef.current;
        if (!plan) {
          wheelSpinRafRef.current = null;
          return;
        }
        const nowMs = Date.now();

        if (nowMs < plan.spinStartsAtMs) {
          wheelSpinRafRef.current = requestAnimationFrame(tick);
          return;
        }

        const clampedNowMs = Math.min(nowMs, plan.settleAtMs);
        const progress = Math.max(0, Math.min(1, (clampedNowMs - plan.spinStartsAtMs) / Math.max(1, plan.settleAtMs - plan.spinStartsAtMs)));
        const easedProgress = easeOutCubic(easeOutCubic(progress));
        // Follow one single trajectory to the exact final target (including
        // optional edge landing) to avoid any end-of-spin teleport.
        const pathSteps = plan.targetContinuous - plan.startContinuous;
        const currentContinuous = plan.startContinuous + pathSteps * easedProgress;
        const wholeSteps = Math.floor(currentContinuous);
        const fractionalSteps = currentContinuous - wholeSteps;
        setWheelIndexSafe(wholeSteps);
        setPointerOffsetSafe(fractionalSteps * slotPx);

        if (nowMs >= plan.settleAtMs) {
          const finalWhole = Math.floor(plan.targetContinuous);
          const finalFraction = plan.targetContinuous - finalWhole;
          // Render deterministic final frame once and finish, avoiding
          // side-to-side micro jumps at the exact end.
          setWheelIndexSafe(finalWhole);
          setPointerOffsetSafe(finalFraction * slotPx, true);
          completedRoundIdRef.current = plan.roundKey;
          spinPlanRef.current = null;
          wheelSpinRafRef.current = null;
          return;
        }

        wheelSpinRafRef.current = requestAnimationFrame(tick);
      };

      wheelSpinRafRef.current = requestAnimationFrame(tick);
    },
    [setPointerOffsetSafe, setWheelIndexSafe, slotWidthPx, stopWheelSpinAnimation]
  );

  const queueHistoryItem = useCallback((item: RouletteResultHistoryItem) => {
    pendingHistoryByRoundIdRef.current.set(item.roundId, item);
  }, []);

  const showSettlementSummary = useCallback(
    (payload: {
      roundNumber: number;
      winningNumber: number;
      winningColor: string;
      outcomes: Array<{ userId: string; userLabel: string; netAtomic: string }>;
    }) => {
      setSettlementSummary(payload);
      if (settlementHideTimerRef.current) {
        clearTimeout(settlementHideTimerRef.current);
      }
      settlementHideTimerRef.current = setTimeout(() => {
        setSettlementSummary(null);
      }, 5_000);
    },
    []
  );

  const updateCountdown = useCallback(() => {
    if (!round) {
      setCountdown("");
      return;
    }

    const now = Date.now();
    const betsClose = new Date(round.betsCloseAt).getTime();

    if (round.status === "OPEN" || round.status === "CLOSED") {
      setCountdown(`Bets close in ${formatSecondsWithMilliseconds(betsClose - now)}`);
      return;
    }

    setCountdown("");
  }, [round]);

  useEffect(() => {
    const interval = setInterval(updateCountdown, COUNTDOWN_TICK_MS);
    updateCountdown();
    return () => clearInterval(interval);
  }, [updateCountdown]);

  const normalizeBreakdown = useCallback((raw: RouletteBetBreakdown | BetBreakdownEvent): RouletteBetBreakdown => {
    return {
      ...raw,
      entriesByType: raw.entriesByType ?? {
        RED: [],
        BLACK: [],
        GREEN: [],
        BAIT: []
      }
    };
  }, []);

  useEffect(() => {
    Promise.all([
      getCurrentRound(INTERNAL_GAME_CURRENCY),
      getRouletteRecentResults(INTERNAL_GAME_CURRENCY, 20),
      getCurrentRouletteBetBreakdown(INTERNAL_GAME_CURRENCY)
    ])
      .then(([current, recentResults, breakdown]) => {
        setRound(current);
        setHistory(recentResults);
        setBetBreakdown(normalizeBreakdown(breakdown));
      })
      .catch(() => {});

    const sock = new CasinoSocket(INTERNAL_GAME_CURRENCY);
    socketRef.current = sock;

    sock.subscribe((ev: SocketEvent) => {
      switch (ev.type) {
        case "open":
          setWsStatus("connected");
          break;
        case "close":
          setWsStatus("disconnected");
          break;
        case "error":
          setWsStatus("error");
          break;
        case "roulette.round":
          if (ev.data.status === "SETTLED" && ev.data.winningNumber !== null) {
            queueHistoryItem({
              roundId: ev.data.roundId,
              roundNumber: ev.data.roundNumber,
              currency: ev.data.currency,
              winningNumber: ev.data.winningNumber,
              winningColor: ev.data.winningColor ?? "GREEN",
              totalStakedAtomic: ev.data.totalStakedAtomic,
              totalPayoutAtomic: ev.data.totalPayoutAtomic,
              settledAt: new Date().toISOString()
            });
          }

          setRound((previous) => {
            if (!previous) {
              return ev.data;
            }
            return ev.data.roundNumber >= previous.roundNumber ? ev.data : previous;
          });
          break;
        case "roulette.betBreakdown":
          setBetBreakdown(normalizeBreakdown(ev.data));
          break;
        case "roulette.settlementSummary":
          showSettlementSummary({
            roundNumber: ev.data.roundNumber,
            winningNumber: ev.data.winningNumber,
            winningColor: ev.data.winningColor,
            outcomes: ev.data.outcomes
          });
          break;
      }
    });

    sock.connect();
    return () => sock.disconnect();
  }, [normalizeBreakdown, queueHistoryItem, showSettlementSummary]);

  useEffect(() => {
    const node = wheelGridRef.current;
    if (!node) {
      return;
    }

    const updateSlotWidth = () => {
      const width = node.getBoundingClientRect().width;
      if (!Number.isFinite(width) || width <= 0) {
        return;
      }
      setSlotWidthPx(width / WHEEL_VISIBLE_SLOTS);
    };

    updateSlotWidth();
    const observer = new ResizeObserver(updateSlotWidth);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!round) {
      return;
    }

    const roundKey = "roundId" in round ? round.roundId : round.id;

    if (lastRoundIdRef.current !== roundKey) {
      lastRoundIdRef.current = roundKey;
      completedRoundIdRef.current = null;
    }

    if ((round.status === "SPINNING" || round.status === "SETTLED") && round.winningNumber !== null) {
      startWheelSpinAnimation(
        roundKey,
        new Date(round.spinStartsAt).getTime(),
        new Date(round.settleAt).getTime(),
        round.winningNumber
      );
      if (round.status === "SETTLED") {
        flushPendingHistoryForRound(roundKey);
      }
      return;
    }

    stopWheelSpinAnimation();
  }, [
    flushPendingHistoryForRound,
    round,
    startWheelSpinAnimation,
    stopWheelSpinAnimation
  ]);

  useEffect(() => {
    return () => {
      if (settlementHideTimerRef.current) {
        clearTimeout(settlementHideTimerRef.current);
      }
      stopWheelSpinAnimation();
      setPointerOffsetSafe(0, true);
    };
  }, [setPointerOffsetSafe, stopWheelSpinAnimation]);

  const placeBet = async (forcedType?: BetType) => {
    if (!authed || !getAccessToken()) {
      openAuth("register");
      setError("Create an account to place bets.");
      return;
    }

    if (!round || round.status !== "OPEN") {
      setError("Betting is closed for this round. Wait for the next OPEN round.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const selectedType = forcedType ?? betType;
      const stakeAtomic = coinsToAtomicString(stakeCoins);
      await placeRouletteBet(INTERNAL_GAME_CURRENCY, selectedType, stakeAtomic);
      setBetType(selectedType);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bet failed");
    } finally {
      setLoading(false);
    }
  };

  const adjustStake = (delta: number) => {
    const current = Number(stakeCoins) || 0;
    const next = Math.max(0, current + delta);
    setStakeCoins(next.toFixed(2));
  };

  const scaleStake = (factor: number) => {
    const current = Number(stakeCoins) || 0;
    const next = Math.max(0, current * factor);
    setStakeCoins(next.toFixed(2));
  };

  const phaseProgressPercent = (() => {
    if (!round) {
      return 0;
    }

    const now = Date.now();
    const clamp = (value: number) => Math.max(0, Math.min(100, value));
    if (round.status === "OPEN") {
      const total = new Date(round.betsCloseAt).getTime() - new Date(round.openAt).getTime();
      const elapsed = now - new Date(round.openAt).getTime();
      return total <= 0 ? 100 : clamp((elapsed / total) * 100);
    }

    if (round.status === "CLOSED") {
      const total = new Date(round.spinStartsAt).getTime() - new Date(round.betsCloseAt).getTime();
      const elapsed = now - new Date(round.betsCloseAt).getTime();
      return total <= 0 ? 100 : clamp((elapsed / total) * 100);
    }

    if (round.status === "SPINNING") {
      const total = new Date(round.settleAt).getTime() - new Date(round.spinStartsAt).getTime();
      const elapsed = now - new Date(round.spinStartsAt).getTime();
      return total <= 0 ? 100 : clamp((elapsed / total) * 100);
    }

    return 100;
  })();

  const wheelNumbers = useMemo(
    () =>
      Array.from({ length: WHEEL_VISIBLE_SLOTS + WHEEL_TRACK_SIDE_BUFFER * 2 }, (_, offset) => {
        const idx = mod(wheelIndex - WHEEL_CENTER_SLOT - WHEEL_TRACK_SIDE_BUFFER + offset, WHEEL_SEQUENCE.length);
        return WHEEL_SEQUENCE[idx];
      }),
    [wheelIndex]
  );
  const slotWidthSafePx = Math.max(1, slotWidthPx);
  const trackVisualOffsetPx = -pointerOffsetPx;
  const trackBaseOffsetPx = -WHEEL_TRACK_SIDE_BUFFER * slotWidthSafePx;
  const pointerSlotShift = Math.round(pointerOffsetPx / slotWidthSafePx);
  const highlightedSlotIndex = mod(
    WHEEL_TRACK_SIDE_BUFFER + WHEEL_CENTER_SLOT + pointerSlotShift,
    WHEEL_VISIBLE_SLOTS + WHEEL_TRACK_SIDE_BUFFER * 2
  );
  const highlightedNumber = wheelNumbers[highlightedSlotIndex] ?? null;

  const totalBreakdownCoins = betBreakdown ? toCoinsNumber(betBreakdown.totalStakedAtomic) : 0;
  const getBetTotalCoins = (type: BetType): number =>
    betBreakdown ? toCoinsNumber(betBreakdown.totalsAtomic[type]) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-wide">Roulette Live</h1>
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-1 rounded text-xs font-medium ${
              wsStatus === "connected" ? "bg-green-900 text-green-300" : "bg-gray-800 text-gray-400"
            }`}
          >
            WS: {wsStatus}
          </span>
        </div>
      </div>

      <Card className="bg-gradient-to-br from-slate-900 to-gray-900 border-gray-700">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400 uppercase tracking-widest">Last 20</span>
            <div className="flex items-center gap-1 flex-wrap">
              {history.slice(0, 20).map((item) => (
                <span
                  key={item.roundId}
                  className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-semibold ${
                    item.winningColor === "RED"
                      ? "bg-red-700 text-white"
                      : item.winningColor === "BLACK"
                      ? "bg-gray-800 border border-gray-600 text-gray-200"
                      : "bg-emerald-700 text-white"
                  }`}
                  title={`Round #${item.roundNumber}`}
                >
                  {item.winningNumber}
                </span>
              ))}
            </div>
          </div>

          <div className="relative rounded-lg bg-gray-950/80 border border-gray-800 px-2 py-4">
            <div
              className="absolute top-1 -translate-x-1/2 w-0 h-0 border-l-[9px] border-r-[9px] border-t-[14px] border-l-transparent border-r-transparent border-t-yellow-300"
              style={{ left: "50%" }}
            />
            <div
              ref={wheelGridRef}
              className="overflow-hidden py-2"
            >
              <div
                className="flex"
                style={{
                  transform: `translateX(${trackBaseOffsetPx + trackVisualOffsetPx}px)`,
                  willChange: "transform"
                }}
              >
                {wheelNumbers.map((n, idx) => {
                  const color = getNumberColor(n);
                  const isHighlighted = idx === highlightedSlotIndex;
                  return (
                    <div
                      key={`${n}-${idx}`}
                      className={`h-9 rounded flex shrink-0 items-center justify-center text-xs font-semibold transition-all ${
                        color === "RED"
                          ? "bg-red-700 text-white"
                          : color === "BLACK"
                          ? "bg-gray-800 text-gray-300 border border-gray-700"
                          : "bg-emerald-700 text-white"
                      } ${isHighlighted ? "ring-2 ring-yellow-300 scale-105" : ""}`}
                      style={{ width: `${slotWidthSafePx}px` }}
                    >
                      {n}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {countdown ? (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Bets close in</span>
                <span className="text-yellow-300">{countdown.replace(/^Bets close in\s+/i, "")}</span>
              </div>
              <div className="w-full h-2 rounded bg-gray-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-yellow-400 transition-all"
                  style={{ width: `${phaseProgressPercent}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      {settlementSummary && (
        <Card title="Settlement Summary (5s)">
          <div className="space-y-2">
            <p className="text-sm text-gray-300">
              Round #{settlementSummary.roundNumber} — Winning number {settlementSummary.winningNumber} (
              {settlementSummary.winningColor})
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {settlementSummary.outcomes.map((entry) => {
                const positive = !entry.netAtomic.startsWith("-");
                return (
                  <div
                    key={entry.userId}
                    className="text-sm rounded bg-gray-900 border border-gray-800 px-3 py-2 flex justify-between"
                  >
                    <span className="text-gray-300">{entry.userLabel}</span>
                    <span className={positive ? "text-green-400 font-mono" : "text-red-400 font-mono"}>
                      {formatSignedAtomicAsCoins(entry.netAtomic)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      <Card title="Play amount">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-end">
            <Input
              label={`Stake (${VIRTUAL_CURRENCY_LABEL})`}
              value={stakeCoins}
              onChange={(e) => setStakeCoins(e.target.value)}
              placeholder="10.00"
            />
            <div className="flex items-center gap-1 flex-wrap">
              <Button variant="secondary" className="text-xs px-2 py-1" onClick={() => adjustStake(1)}>
                +1
              </Button>
              <Button variant="secondary" className="text-xs px-2 py-1" onClick={() => adjustStake(10)}>
                +10
              </Button>
              <Button variant="secondary" className="text-xs px-2 py-1" onClick={() => adjustStake(100)}>
                +100
              </Button>
              <Button variant="secondary" className="text-xs px-2 py-1" onClick={() => scaleStake(0.5)}>
                1/2
              </Button>
              <Button variant="secondary" className="text-xs px-2 py-1" onClick={() => scaleStake(2)}>
                x2
              </Button>
            </div>
          </div>
          <p className="text-xs text-gray-500">1 USD = 1 COIN · BAIT wins when number is 1 or 14.</p>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {BET_TYPES.map((type) => {
          const config = BET_CONFIG[type];
          const amountCoins = getBetTotalCoins(type);
          const share = totalBreakdownCoins > 0 ? (amountCoins / totalBreakdownCoins) * 100 : 0;
          const entries = (betBreakdown?.entriesByType?.[type] ?? []).slice(0, 8);
          return (
            <Card key={type} className="bg-gray-900/90 border-gray-700">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className={`font-semibold ${config.accent}`}>{config.label}</span>
                  <span className="text-xs text-yellow-300">{config.payoutLabel}</span>
                </div>
                <Button
                  variant={config.buttonVariant}
                  className={`w-full ${betType === type ? "ring-2 ring-indigo-300" : ""}`}
                  onClick={() => void placeBet(type)}
                  disabled={loading || !stakeCoins || round?.status !== "OPEN"}
                >
                  {loading && betType === type ? "PLAYING..." : "PLAY"}
                </Button>

                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Total on {type}</span>
                    <span className="font-mono">{formatCoins(amountCoins)}</span>
                  </div>
                  <div className="w-full h-1.5 rounded bg-gray-800 overflow-hidden">
                    <div className="h-full bg-indigo-500" style={{ width: `${Math.max(0, Math.min(100, share))}%` }} />
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>Share</span>
                    <span>{share.toFixed(1)}%</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-gray-800">
                  <div className="space-y-1.5">
                    {entries.length > 0 ? (
                      entries.map((entry) => (
                        <div key={`${type}-${entry.userId}`} className="text-xs flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-5 h-5 rounded-full bg-gray-700 border border-gray-600 shrink-0" />
                            <span className="text-gray-300 truncate">{entry.userLabel}</span>
                          </div>
                          <span className="font-mono text-yellow-300 shrink-0">{formatCoins(toCoinsNumber(entry.stakeAtomic))}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-gray-600">No bets yet</p>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {error && (
        <Card>
          <p className="text-red-400 text-sm">{error}</p>
        </Card>
      )}
    </div>
  );
}
