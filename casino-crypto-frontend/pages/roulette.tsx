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
  type RouletteBetResponse,
  type RouletteResultHistoryItem,
  type RouletteRound
} from "@/lib/api";
import { CasinoSocket, type RouletteRoundEvent, type SocketEvent } from "@/lib/socket";

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
const WHEEL_SPIN_STEP_MS = 60;

const COINS_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const mod = (value: number, length: number): number => ((value % length) + length) % length;

const getNumberColor = (n: number): "GREEN" | "RED" | "BLACK" => {
  if (n === 0) {
    return "GREEN";
  }

  return RED_NUMBERS.has(n) ? "RED" : "BLACK";
};

const isWinningForBetType = (item: RouletteResultHistoryItem, betType: BetType): boolean => {
  if (betType === "GREEN") {
    return item.winningNumber === 0;
  }

  if (betType === "BAIT") {
    return item.winningNumber === 1 || item.winningNumber === 14;
  }

  if (betType === "RED") {
    return item.winningColor === "RED";
  }

  return item.winningColor === "BLACK";
};

const toCoinsNumber = (atomic: string): number => {
  const value = Number(atomic);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value / 10 ** COIN_DECIMALS;
};

const formatCoins = (value: number): string => `${COINS_FORMATTER.format(value)} ${VIRTUAL_CURRENCY_LABEL}`;

const formatAtomicAsCoins = (atomic: string): string => formatCoins(toCoinsNumber(atomic));

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
  const [response, setResponse] = useState<RouletteBetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState<string>("");
  const [lastResult, setLastResult] = useState<{ number: number | null; color: string | null } | null>(null);
  const [history, setHistory] = useState<RouletteResultHistoryItem[]>([]);
  const [betBreakdown, setBetBreakdown] = useState<RouletteBetBreakdown | null>(null);
  const [wheelIndex, setWheelIndex] = useState(0);
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
  const settlementHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelSpinTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pushHistoryItem = useCallback((item: RouletteResultHistoryItem) => {
    setHistory((prev) => [item, ...prev.filter((existing) => existing.roundId !== item.roundId)].slice(0, 20));
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
      const diff = Math.max(0, Math.floor((betsClose - now) / 1000));
      setCountdown(`Bets close in ${diff}s`);
      return;
    }

    if (round.status === "CLOSED") {
      const diff = Math.max(0, Math.floor((spinStarts - now) / 1000));
      setCountdown(`Spinning in ${diff}s`);
      return;
    }

    if (round.status === "SPINNING") {
      const diff = Math.max(0, Math.floor((settle - now) / 1000));
      setCountdown(`Rolling in ${diff}s`);
      return;
    }

    if (round.status === "SETTLED") {
      setCountdown("Settled");
      if (round.winningNumber !== null) {
        setLastResult({ number: round.winningNumber, color: round.winningColor ?? null });
      }
      return;
    }

    setCountdown(round.status);
  }, [round]);

  useEffect(() => {
    const interval = setInterval(updateCountdown, 500);
    updateCountdown();
    return () => clearInterval(interval);
  }, [updateCountdown]);

  useEffect(() => {
    Promise.all([
      getCurrentRound(INTERNAL_GAME_CURRENCY),
      getRouletteRecentResults(INTERNAL_GAME_CURRENCY, 20),
      getCurrentRouletteBetBreakdown(INTERNAL_GAME_CURRENCY)
    ])
      .then(([current, recentResults, breakdown]) => {
        setRound(current);
        setHistory(recentResults);
        setBetBreakdown(breakdown);

        if (current.status === "SETTLED" && current.winningNumber !== null) {
          setLastResult({ number: current.winningNumber, color: current.winningColor ?? null });
        } else if (recentResults[0]) {
          setLastResult({ number: recentResults[0].winningNumber, color: recentResults[0].winningColor });
        } else {
          setLastResult(null);
        }
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
            setLastResult({ number: ev.data.winningNumber, color: ev.data.winningColor ?? null });
            pushHistoryItem({
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
          setBetBreakdown(ev.data);
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
  }, [pushHistoryItem, showSettlementSummary]);

  useEffect(() => {
    if (!round) {
      return;
    }

    if (round.status === "SPINNING") {
      if (!wheelSpinTimerRef.current) {
        wheelSpinTimerRef.current = setInterval(() => {
          setWheelIndex((prev) => mod(prev + 1, WHEEL_SEQUENCE.length));
        }, WHEEL_SPIN_STEP_MS);
      }
      return;
    }

    if (wheelSpinTimerRef.current) {
      clearInterval(wheelSpinTimerRef.current);
      wheelSpinTimerRef.current = null;
    }

    if (round.status === "SETTLED" && round.winningNumber !== null) {
      const target = WHEEL_SEQUENCE.indexOf(round.winningNumber);
      if (target >= 0) {
        setWheelIndex(target);
      }
    }
  }, [round]);

  useEffect(() => {
    return () => {
      if (settlementHideTimerRef.current) {
        clearTimeout(settlementHideTimerRef.current);
      }

      if (wheelSpinTimerRef.current) {
        clearInterval(wheelSpinTimerRef.current);
      }
    };
  }, []);

  const placeBet = async (forcedType?: BetType) => {
    if (!round || round.status !== "OPEN") {
      setError("Betting is closed for this round. Wait for the next OPEN round.");
      return;
    }

    setError(null);
    setResponse(null);
    setLoading(true);

    try {
      const selectedType = forcedType ?? betType;
      const stakeAtomic = coinsToAtomicString(stakeCoins);
      const res = await placeRouletteBet(INTERNAL_GAME_CURRENCY, selectedType, stakeAtomic);
      setBetType(selectedType);
      setResponse(res);
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
      Array.from({ length: WHEEL_VISIBLE_SLOTS }, (_, offset) => {
        const idx = mod(wheelIndex - WHEEL_CENTER_SLOT + offset, WHEEL_SEQUENCE.length);
        return WHEEL_SEQUENCE[idx];
      }),
    [wheelIndex]
  );

  const totalBreakdownCoins = betBreakdown ? toCoinsNumber(betBreakdown.totalStakedAtomic) : 0;
  const getBetTotalCoins = (type: BetType): number =>
    betBreakdown ? toCoinsNumber(betBreakdown.totalsAtomic[type]) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-wide">Roulette Live</h1>
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 rounded text-xs font-medium bg-gray-800 text-gray-300">{VIRTUAL_CURRENCY_LABEL}</span>
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
            <div className="absolute left-1/2 top-1 -translate-x-1/2 w-0 h-0 border-l-[9px] border-r-[9px] border-t-[14px] border-l-transparent border-r-transparent border-t-yellow-300" />
            <div className="flex items-center gap-1 overflow-x-auto py-2">
              {wheelNumbers.map((n, idx) => {
                const color = getNumberColor(n);
                const isCenter = idx === WHEEL_CENTER_SLOT;
                return (
                  <div
                    key={`${n}-${idx}`}
                    className={`min-w-9 h-9 rounded flex items-center justify-center text-xs font-semibold transition-all ${
                      color === "RED"
                        ? "bg-red-700 text-white"
                        : color === "BLACK"
                        ? "bg-gray-800 text-gray-300 border border-gray-700"
                        : "bg-emerald-700 text-white"
                    } ${isCenter ? "ring-2 ring-yellow-300 scale-105" : ""}`}
                  >
                    {n}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>{round ? `Round #${round.roundNumber}` : "Waiting round..."}</span>
              <span className="text-yellow-300">{countdown}</span>
            </div>
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
          const recentHits = history.filter((item) => isWinningForBetType(item, type)).slice(0, 3);
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
                  <p className="text-[11px] text-gray-500 mb-1">Recent hits</p>
                  <div className="space-y-1">
                    {recentHits.length > 0 ? (
                      recentHits.map((item) => (
                        <div key={`${type}-${item.roundId}`} className="text-xs flex justify-between">
                          <span className="text-gray-400">Round #{item.roundNumber}</span>
                          <span className="font-mono text-gray-200">{item.winningNumber}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-gray-600">No recent hits</p>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {(response || error) && (
        <Card title="Bet Result">
          {error && <p className="text-red-400 text-sm mb-2">{error}</p>}
          {response && (
            <div className="text-sm text-gray-300 space-y-1 bg-gray-800 p-3 rounded">
              <p>
                Bet placed in round <span className="font-mono">#{response.round.roundNumber}</span>
              </p>
              <p>
                Type: <span className="font-semibold">{response.bet.betType}</span>
              </p>
              <p>
                Stake ({VIRTUAL_CURRENCY_LABEL}):{" "}
                <span className="font-mono">{formatAtomicAsCoins(response.bet.stakeAtomic)}</span>
              </p>
              <p>
                Status: <span className="font-semibold">{response.bet.status}</span>
              </p>
            </div>
          )}
        </Card>
      )}

      {lastResult && (
        <Card title="Last Result">
          <div className="flex items-center gap-3">
            <span
              className={`w-10 h-10 rounded-full text-sm font-bold flex items-center justify-center ${
                lastResult.color === "RED"
                  ? "bg-red-700 text-white"
                  : lastResult.color === "BLACK"
                  ? "bg-gray-800 text-gray-200 border border-gray-600"
                  : "bg-emerald-700 text-white"
              }`}
            >
              {lastResult.number}
            </span>
            <span className="text-sm text-gray-300">{lastResult.color}</span>
          </div>
        </Card>
      )}
    </div>
  );
}
