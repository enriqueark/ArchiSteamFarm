import { useEffect, useState, useRef, useCallback } from "react";
import Card from "@/components/Card";
import Button from "@/components/Button";
import Input from "@/components/Input";
import {
  getCurrentRouletteBetBreakdown,
  placeRouletteBet,
  getCurrentRound,
  getRouletteRecentResults,
  type RouletteBetBreakdown,
  type RouletteRound,
  type RouletteBetResponse,
  type RouletteResultHistoryItem,
} from "@/lib/api";
import { CasinoSocket, type SocketEvent, type RouletteRoundEvent } from "@/lib/socket";

const BET_TYPES = ["RED", "BLACK", "GREEN", "BAIT"] as const;
const CURRENCIES = ["USDT", "BTC", "ETH", "USDC"] as const;
type RouletteCurrency = (typeof CURRENCIES)[number];
const ATOMIC_DECIMALS = 8;
const DEFAULT_USD_RATES: Record<RouletteCurrency, number> = {
  USDT: 1,
  USDC: 1,
  BTC: 65_000,
  ETH: 3_500
};
const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 11, 13]);
const WHEEL_SEQUENCE = [14, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const WHEEL_TRACK = [...WHEEL_SEQUENCE, ...WHEEL_SEQUENCE];

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

export default function RoulettePage() {
  const [round, setRound] = useState<RouletteRound | RouletteRoundEvent | null>(null);
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [currency, setCurrency] = useState<RouletteCurrency>("USDT");
  const [stakeUsd, setStakeUsd] = useState("10");
  const [usdRates, setUsdRates] = useState<Record<RouletteCurrency, number>>(DEFAULT_USD_RATES);
  const [betType, setBetType] = useState<string>("RED");
  const [response, setResponse] = useState<RouletteBetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState<string>("");
  const [lastResult, setLastResult] = useState<{ number: number | null; color: string | null } | null>(null);
  const [history, setHistory] = useState<RouletteResultHistoryItem[]>([]);
  const [betBreakdown, setBetBreakdown] = useState<RouletteBetBreakdown | null>(null);
  const [settlementSummary, setSettlementSummary] = useState<
    | {
        roundNumber: number;
        winningNumber: number;
        winningColor: string;
      currency: string;
        outcomes: Array<{ userId: string; userLabel: string; netAtomic: string }>;
      }
    | null
  >(null);

  const socketRef = useRef<CasinoSocket | null>(null);
  const settlementHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const formatUsd = useCallback((value: number) => USD_FORMATTER.format(Number.isFinite(value) ? value : 0), []);

  const getUsdRate = useCallback(
    (currencyCode: string): number => usdRates[currencyCode as RouletteCurrency] ?? 1,
    [usdRates]
  );

  const atomicToUsdValue = useCallback(
    (atomic: string, currencyCode: string): number => {
      const atomicValue = Number(atomic);
      if (!Number.isFinite(atomicValue)) {
        return 0;
      }

      const tokenAmount = atomicValue / 10 ** ATOMIC_DECIMALS;
      return tokenAmount * getUsdRate(currencyCode);
    },
    [getUsdRate]
  );

  const formatAtomicAsUsd = useCallback(
    (atomic: string, currencyCode: string): string => formatUsd(atomicToUsdValue(atomic, currencyCode)),
    [atomicToUsdValue, formatUsd]
  );

  const formatSignedAtomicAsUsd = useCallback(
    (atomic: string, currencyCode: string): string => {
      const usdValue = atomicToUsdValue(atomic, currencyCode);
      const sign = usdValue >= 0 ? "+" : "-";
      return `${sign}${formatUsd(Math.abs(usdValue))}`;
    },
    [atomicToUsdValue, formatUsd]
  );

  const usdToAtomicString = useCallback(
    (usdValueRaw: string, currencyCode: RouletteCurrency): string => {
      const usdValue = Number(usdValueRaw);
      if (!Number.isFinite(usdValue) || usdValue <= 0) {
        throw new Error("Stake must be a positive USD value");
      }

      const rate = getUsdRate(currencyCode);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error("USD conversion rate is unavailable");
      }

      const tokenAmount = usdValue / rate;
      const atomic = Math.round(tokenAmount * 10 ** ATOMIC_DECIMALS);
      if (!Number.isFinite(atomic) || atomic <= 0) {
        throw new Error("Stake is too low for current conversion rate");
      }

      return String(atomic);
    },
    [getUsdRate]
  );

  const pushHistoryItem = useCallback((item: RouletteResultHistoryItem) => {
    setHistory((prev) => {
      const next = [item, ...prev.filter((existing) => existing.roundId !== item.roundId)];
      return next.slice(0, 20);
    });
  }, []);

  const showSettlementSummary = useCallback(
    (payload: {
      roundNumber: number;
      winningNumber: number;
      winningColor: string;
      currency: string;
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
    } else if (round.status === "CLOSED") {
      const diff = Math.max(0, Math.floor((spinStarts - now) / 1000));
      setCountdown(`Spinning in ${diff}s`);
    } else if (round.status === "SPINNING") {
      const diff = Math.max(0, Math.floor((settle - now) / 1000));
      setCountdown(`Settling in ${diff}s`);
    } else if (round.status === "SETTLED") {
      setCountdown("Settled");
      if (round.winningNumber !== null) {
        setLastResult({ number: round.winningNumber, color: round.winningColor ?? null });
      }
    } else {
      setCountdown(round.status);
    }
  }, [round]);

  useEffect(() => {
    let cancelled = false;

    const loadUsdRates = async () => {
      try {
        const response = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether,usd-coin&vs_currencies=usd"
        );
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as Record<string, { usd?: number }>;
        const nextRates: Record<RouletteCurrency, number> = {
          BTC: payload.bitcoin?.usd ?? DEFAULT_USD_RATES.BTC,
          ETH: payload.ethereum?.usd ?? DEFAULT_USD_RATES.ETH,
          USDT: payload.tether?.usd ?? DEFAULT_USD_RATES.USDT,
          USDC: payload["usd-coin"]?.usd ?? DEFAULT_USD_RATES.USDC
        };

        if (!cancelled) {
          setUsdRates(nextRates);
        }
      } catch {
        // Keep defaults when quote provider is unavailable.
      }
    };

    void loadUsdRates();
    const interval = setInterval(() => {
      void loadUsdRates();
    }, 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (settlementHideTimerRef.current) {
        clearTimeout(settlementHideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(updateCountdown, 500);
    updateCountdown();
    return () => clearInterval(interval);
  }, [updateCountdown]);

  useEffect(() => {
    Promise.all([
      getCurrentRound(currency),
      getRouletteRecentResults(currency, 20),
      getCurrentRouletteBetBreakdown(currency),
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

    const sock = new CasinoSocket(currency);
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
              settledAt: new Date().toISOString(),
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
            currency: ev.data.currency,
            outcomes: ev.data.outcomes
          });
          break;
      }
    });

    sock.connect();
    return () => sock.disconnect();
  }, [currency, pushHistoryItem, showSettlementSummary]);

  const placeBet = async (forcedType?: BetType) => {
    if (!round || round.status !== "OPEN") {
      setError("Betting is closed for this round. Wait for the next OPEN round.");
      return;
    }

    setError(null);
    setResponse(null);
    setLoading(true);
    try {
      const stakeAtomic = usdToAtomicString(stakeUsd, currency);
      const selectedType = forcedType ?? (betType as BetType);
      const res = await placeRouletteBet(currency, selectedType, stakeAtomic);
      setResponse(res);
      setBetType(selectedType);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bet failed");
    } finally {
      setLoading(false);
    }
  };

  const adjustStakeUsd = (delta: number) => {
    const current = Number(stakeUsd) || 0;
    const next = Math.max(0, current + delta);
    setStakeUsd(next.toFixed(2));
  };

  const scaleStakeUsd = (factor: number) => {
    const current = Number(stakeUsd) || 0;
    const next = Math.max(0, current * factor);
    setStakeUsd(next.toFixed(2));
  };

  const totalBreakdownUsd = betBreakdown
    ? atomicToUsdValue(betBreakdown.totalStakedAtomic, betBreakdown.currency)
    : 0;

  const getBetTotalUsd = (type: BetType): number => {
    if (!betBreakdown) {
      return 0;
    }
    return atomicToUsdValue(betBreakdown.totalsAtomic[type], betBreakdown.currency);
  };

  const selectedRate = getUsdRate(currency);
  const phaseProgressPercent = (() => {
    if (!round) {
      return 0;
    }

    const now = Date.now();
    const clamp = (value: number) => Math.max(0, Math.min(100, value));
    if (round.status === "OPEN") {
      const total = new Date(round.betsCloseAt).getTime() - new Date(round.openAt).getTime();
      const elapsed = now - new Date(round.openAt).getTime();
      if (total <= 0) {
        return 100;
      }
      return clamp((elapsed / total) * 100);
    }

    if (round.status === "CLOSED") {
      const total = new Date(round.spinStartsAt).getTime() - new Date(round.betsCloseAt).getTime();
      const elapsed = now - new Date(round.betsCloseAt).getTime();
      if (total <= 0) {
        return 100;
      }
      return clamp((elapsed / total) * 100);
    }

    if (round.status === "SPINNING") {
      const total = new Date(round.settleAt).getTime() - new Date(round.spinStartsAt).getTime();
      const elapsed = now - new Date(round.spinStartsAt).getTime();
      if (total <= 0) {
        return 100;
      }
      return clamp((elapsed / total) * 100);
    }

    return 100;
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-wide">Roulette Live</h1>
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 rounded text-xs font-medium bg-gray-800 text-gray-300">{currency}</span>
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

          <div className="relative rounded-lg bg-gray-950/80 border border-gray-800 px-2 py-3">
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[10px] text-yellow-300 bg-gray-900 px-2 rounded">
              LIVE TRACK
            </span>
            <div className="flex items-center gap-1 overflow-x-auto py-1">
              {WHEEL_TRACK.map((n, idx) => {
                const color = getNumberColor(n);
                const active = round?.winningNumber === n && round?.status === "SETTLED";
                return (
                  <div
                    key={`${n}-${idx}`}
                    className={`min-w-8 h-8 rounded flex items-center justify-center text-xs font-semibold ${
                      color === "RED"
                        ? "bg-red-700 text-white"
                        : color === "BLACK"
                        ? "bg-gray-800 text-gray-300 border border-gray-700"
                        : "bg-emerald-700 text-white"
                    } ${active ? "ring-2 ring-yellow-300" : ""}`}
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
                      {formatSignedAtomicAsUsd(entry.netAtomic, settlementSummary.currency)}
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
            <div className="flex flex-col gap-1">
              <label className="text-sm text-gray-400">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as RouletteCurrency)}
                className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <Input label="Stake (USD)" value={stakeUsd} onChange={(e) => setStakeUsd(e.target.value)} placeholder="10.00" />
            <div className="flex items-center gap-1 flex-wrap">
              <Button variant="secondary" className="text-xs px-2 py-1" onClick={() => adjustStakeUsd(1)}>
                +1
              </Button>
              <Button variant="secondary" className="text-xs px-2 py-1" onClick={() => adjustStakeUsd(10)}>
                +10
              </Button>
              <Button variant="secondary" className="text-xs px-2 py-1" onClick={() => adjustStakeUsd(100)}>
                +100
              </Button>
              <Button variant="secondary" className="text-xs px-2 py-1" onClick={() => scaleStakeUsd(0.5)}>
                1/2
              </Button>
              <Button variant="secondary" className="text-xs px-2 py-1" onClick={() => scaleStakeUsd(2)}>
                x2
              </Button>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            1 {currency} ≈ {formatUsd(selectedRate)} · BAIT wins when number is 1 or 14.
          </p>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {BET_TYPES.map((type) => {
          const config = BET_CONFIG[type];
          const amountUsd = getBetTotalUsd(type);
          const share = totalBreakdownUsd > 0 ? (amountUsd / totalBreakdownUsd) * 100 : 0;
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
                  disabled={loading || !stakeUsd || round?.status !== "OPEN"}
                >
                  {loading && betType === type ? "PLAYING..." : "PLAY"}
                </Button>

                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Total on {type}</span>
                    <span className="font-mono">{formatUsd(amountUsd)}</span>
                  </div>
                  <div className="w-full h-1.5 rounded bg-gray-800 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500"
                      style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
                    />
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
                Stake (USD):{" "}
                <span className="font-mono">{formatAtomicAsUsd(response.bet.stakeAtomic, response.round.currency)}</span>
              </p>
              <p>
                Status: <span className="font-semibold">{response.bet.status}</span>
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
