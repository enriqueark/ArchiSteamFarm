import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/Button";
import Card from "@/components/Card";
import Input from "@/components/Input";
import {
  getCurrentRouletteBetBreakdown,
  getCurrentRound,
  getRouletteRecentResults,
  placeRouletteBet,
  type RouletteBetBreakdown,
  type RouletteResultHistoryItem,
  type RouletteRound
} from "@/lib/api";
import { CasinoSocket, type BetBreakdownEvent, type RouletteRoundEvent, type SocketEvent } from "@/lib/socket";

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
  const wheelProgressRef = useRef(0);
  const wheelSpinRafRef = useRef<number | null>(null);
  const wheelSettleRafRef = useRef<number | null>(null);
  const finalizeAfterSpinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousRoundStatusRef = useRef<string | null>(null);
  const lastRoundIdRef = useRef<string | null>(null);
  const finalizedRoundIdRef = useRef<string | null>(null);
  const finalizingRoundIdRef = useRef<string | null>(null);
  const expectedWinningNumberRef = useRef<number | null>(null);
  const pendingHistoryByRoundIdRef = useRef<Map<string, RouletteResultHistoryItem>>(new Map());
  const settleFinalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    wheelProgressRef.current = 0;
  }, []);

  const stopWheelSettleAnimation = useCallback(() => {
    if (wheelSettleRafRef.current !== null) {
      cancelAnimationFrame(wheelSettleRafRef.current);
      wheelSettleRafRef.current = null;
    }
  }, []);

  const clearFinalizeAfterSpinTimer = useCallback(() => {
    if (finalizeAfterSpinTimerRef.current) {
      clearTimeout(finalizeAfterSpinTimerRef.current);
      finalizeAfterSpinTimerRef.current = null;
    }
  }, []);

  const flushPendingHistoryForRound = useCallback((roundId: string) => {
    const item = pendingHistoryByRoundIdRef.current.get(roundId);
    if (!item) {
      return;
    }
    pendingHistoryByRoundIdRef.current.delete(roundId);
    setHistory((prev) => [item, ...prev.filter((existing) => existing.roundId !== item.roundId)].slice(0, 20));
  }, []);

  const animateWheelToWinning = useCallback(
    (winningNumber: number, durationMs: number, minLoops: number, maxLoops: number, onDone?: () => void) => {
      stopWheelSpinAnimation();
      stopWheelSettleAnimation();

      const targetIndex = WHEEL_SEQUENCE.indexOf(winningNumber);
      if (targetIndex < 0) {
        return;
      }

      const slotPx = Math.max(1, slotWidthPx);
      const startFractionRaw = pointerOffsetRef.current / slotPx;
      const normalizedStartOffsetSteps = modFloat(startFractionRaw, 1);
      const startContinuous = wheelIndexRef.current + normalizedStartOffsetSteps;

      const targetContinuous = targetIndex;

      const forwardDistance = modFloat(targetContinuous - startContinuous, WHEEL_SEQUENCE.length);
      const loopSpan = Math.max(minLoops, maxLoops) - Math.min(minLoops, maxLoops) + 1;
      const randomLoops = Math.min(minLoops, maxLoops) + Math.floor(Math.random() * loopSpan);
      const totalSteps = forwardDistance + randomLoops * WHEEL_SEQUENCE.length;
      const effectiveDurationMs = Math.max(250, durationMs);
      const startTime = performance.now();
      let renderedContinuous = Number.NaN;

      const tick = (timestamp: number) => {
        const progress = Math.max(0, Math.min(1, (timestamp - startTime) / effectiveDurationMs));
        const easedProgress = easeOutCubic(progress);
        const progressedSteps = totalSteps * easedProgress;
        const currentContinuous = startContinuous + progressedSteps;

        if (!Number.isFinite(renderedContinuous) || Math.abs(currentContinuous - renderedContinuous) > 0.0001) {
          renderedContinuous = currentContinuous;
          const wholeSteps = Math.floor(currentContinuous);
          const fractionalSteps = currentContinuous - wholeSteps;
          setWheelIndexSafe(wholeSteps);
          setPointerOffsetSafe(fractionalSteps * slotPx);
        }

        if (progress < 1) {
          wheelSettleRafRef.current = requestAnimationFrame(tick);
          return;
        }

        const finalWhole = Math.floor(targetContinuous);
        const finalFraction = targetContinuous - finalWhole;
        setWheelIndexSafe(finalWhole);
        setPointerOffsetSafe(finalFraction * slotPx, true);
        expectedWinningNumberRef.current = winningNumber;
        wheelSettleRafRef.current = null;
        onDone?.();
      };

      wheelSettleRafRef.current = requestAnimationFrame(tick);
    },
    [setPointerOffsetSafe, setWheelIndexSafe, slotWidthPx, stopWheelSettleAnimation, stopWheelSpinAnimation]
  );

  const startWheelSpinAnimation = useCallback(
    (spinStartsAtMs: number, settleAtMs: number) => {
      stopWheelSettleAnimation();
      if (wheelSpinRafRef.current !== null) {
        return;
      }

      const totalDurationMs = Math.max(1, settleAtMs - spinStartsAtMs);
      let lastTimestamp = performance.now();

      const tick = (timestamp: number) => {
        const deltaSeconds = Math.max(0, (timestamp - lastTimestamp) / 1000);
        lastTimestamp = timestamp;
        const nowMs = Date.now();

        if (nowMs < spinStartsAtMs) {
          setPointerOffsetSafe(0);
          wheelSpinRafRef.current = requestAnimationFrame(tick);
          return;
        }

        if (nowMs >= settleAtMs) {
          stopWheelSpinAnimation();
          return;
        }

        const remainingMs = Math.max(0, settleAtMs - Date.now());
        const progressToEnd = Math.max(0, Math.min(1, remainingMs / totalDurationMs));
        const stepsPerSecond =
          WHEEL_SLOW_STEPS_PER_SECOND +
          (WHEEL_FAST_STEPS_PER_SECOND - WHEEL_SLOW_STEPS_PER_SECOND) * progressToEnd ** 2.25;

        wheelProgressRef.current += stepsPerSecond * deltaSeconds;

        if (wheelProgressRef.current >= 1) {
          const steps = Math.floor(wheelProgressRef.current);
          wheelProgressRef.current -= steps;
          setWheelIndexSafe(wheelIndexRef.current + steps);
        }
        setPointerOffsetSafe(wheelProgressRef.current * Math.max(1, slotWidthPx));

        wheelSpinRafRef.current = requestAnimationFrame(tick);
      };

      wheelSpinRafRef.current = requestAnimationFrame(tick);
    },
    [setPointerOffsetSafe, setWheelIndexSafe, slotWidthPx, stopWheelSettleAnimation, stopWheelSpinAnimation]
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
    const spinStarts = new Date(round.spinStartsAt).getTime();
    const settle = new Date(round.settleAt).getTime();

    if (round.status === "OPEN") {
      setCountdown(`Bets close in ${formatSecondsWithMilliseconds(betsClose - now)}`);
      return;
    }

    if (round.status === "CLOSED") {
      setCountdown(`Spinning in ${formatSecondsWithMilliseconds(spinStarts - now)}`);
      return;
    }

    if (round.status === "SPINNING") {
      setCountdown(`Rolling in ${formatSecondsWithMilliseconds(settle - now)}`);
      return;
    }

    if (round.status === "SETTLED") {
      setCountdown("Settled");
      return;
    }

    setCountdown(round.status);
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
            expectedWinningNumberRef.current = ev.data.winningNumber;
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
      finalizedRoundIdRef.current = null;
      finalizingRoundIdRef.current = null;
      clearFinalizeAfterSpinTimer();
    }

    previousRoundStatusRef.current = round.status;

    if (round.status === "SPINNING") {
      clearFinalizeAfterSpinTimer();
      startWheelSpinAnimation(new Date(round.spinStartsAt).getTime(), new Date(round.settleAt).getTime());
      return;
    }

    if (round.status === "SETTLED" && round.winningNumber !== null) {
      const settleAtMs = new Date(round.settleAt).getTime();
      const remainingUntilSettleMs = settleAtMs - Date.now();

      if (finalizedRoundIdRef.current === roundKey || finalizingRoundIdRef.current === roundKey) {
        return;
      }

      // Keep current spin path alive while there is enough time left.
      // Only enter final resolve window close to settleAt to avoid mid-roll teleport.
      if (remainingUntilSettleMs > 900) {
        startWheelSpinAnimation(new Date(round.spinStartsAt).getTime(), settleAtMs);
        if (!finalizeAfterSpinTimerRef.current) {
          finalizeAfterSpinTimerRef.current = setTimeout(() => {
            if (
              lastRoundIdRef.current !== roundKey ||
              finalizedRoundIdRef.current === roundKey ||
              finalizingRoundIdRef.current === roundKey
            ) {
              return;
            }
            finalizingRoundIdRef.current = roundKey;
            const finalWinningNumber = round.winningNumber;
            if (finalWinningNumber === null) {
              finalizingRoundIdRef.current = null;
              finalizeAfterSpinTimerRef.current = null;
              return;
            }
            animateWheelToWinning(finalWinningNumber, 900, 0, 0, () => {
              finalizingRoundIdRef.current = null;
              finalizedRoundIdRef.current = roundKey;
              flushPendingHistoryForRound(roundKey);
            });
            finalizeAfterSpinTimerRef.current = null;
          }, Math.max(0, remainingUntilSettleMs - 900));
        }
        return;
      }

      clearFinalizeAfterSpinTimer();
      finalizingRoundIdRef.current = roundKey;
      const resolveDurationMs = remainingUntilSettleMs > 180 ? remainingUntilSettleMs : 480;
      animateWheelToWinning(round.winningNumber, resolveDurationMs, 0, 0, () => {
        finalizingRoundIdRef.current = null;
        finalizedRoundIdRef.current = roundKey;
        flushPendingHistoryForRound(roundKey);
      });
      return;
    }

    clearFinalizeAfterSpinTimer();
    finalizingRoundIdRef.current = null;
    stopWheelSpinAnimation();
    stopWheelSettleAnimation();
  }, [
    animateWheelToWinning,
    clearFinalizeAfterSpinTimer,
    flushPendingHistoryForRound,
    round,
    setPointerOffsetSafe,
    setWheelIndexSafe,
    startWheelSpinAnimation,
    stopWheelSettleAnimation,
    stopWheelSpinAnimation
  ]);

  useEffect(() => {
    return () => {
      if (settlementHideTimerRef.current) {
        clearTimeout(settlementHideTimerRef.current);
      }
      clearFinalizeAfterSpinTimer();
      stopWheelSpinAnimation();
      stopWheelSettleAnimation();
      setPointerOffsetSafe(0, true);
    };
  }, [clearFinalizeAfterSpinTimer, setPointerOffsetSafe, stopWheelSettleAnimation, stopWheelSpinAnimation]);

  const placeBet = async (forcedType?: BetType) => {
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

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>{round ? round.status : "Waiting round..."}</span>
              <span className="text-yellow-300">{countdown}</span>
            </div>
            {round?.status === "SETTLED" && round.winningNumber !== null && highlightedNumber !== round.winningNumber && (
              <div className="text-[11px] text-red-300">
                Syncing result...
              </div>
            )}
            <div className="w-full h-2 rounded bg-gray-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-yellow-400 transition-all"
                style={{ width: `${phaseProgressPercent}%` }}
              />
            </div>
          </div>
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
