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

  const placeBet = async () => {
    if (!round || round.status !== "OPEN") {
      setError("Betting is closed for this round. Wait for the next OPEN round.");
      return;
    }

    setError(null);
    setResponse(null);
    setLoading(true);
    try {
      const stakeAtomic = usdToAtomicString(stakeUsd, currency);
      const res = await placeRouletteBet(currency, betType, stakeAtomic);
      setResponse(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bet failed");
    } finally {
      setLoading(false);
    }
  };

  const selectedRate = getUsdRate(currency);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Roulette</h1>
        <span
          className={`px-2 py-1 rounded text-xs font-medium ${
            wsStatus === "connected"
              ? "bg-green-900 text-green-300"
              : "bg-gray-800 text-gray-400"
          }`}
        >
          WS: {wsStatus}
        </span>
      </div>

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Current Round">
          {round ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Round #</span>
                <span>{round.roundNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Status</span>
                <span
                  className={`font-medium ${
                    round.status === "OPEN"
                      ? "text-green-400"
                      : round.status === "SPINNING"
                        ? "text-yellow-400"
                        : round.status === "SETTLED"
                          ? "text-indigo-400"
                          : "text-gray-400"
                  }`}
                >
                  {round.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Currency</span>
                <span>{round.currency}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">FX</span>
                <span className="font-mono text-xs">
                  1 {round.currency} ≈ {formatUsd(getUsdRate(round.currency))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Timer</span>
                <span className="font-mono text-yellow-300">{countdown}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Total Staked (USD)</span>
                <span className="font-mono">{formatAtomicAsUsd(round.totalStakedAtomic, round.currency)}</span>
              </div>
              {betBreakdown && (
                <>
                  <div className="pt-2 border-t border-gray-800 mt-2 text-xs text-gray-400">Bets this round</div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-red-400">RED</span>
                      <span className="font-mono">
                        {formatAtomicAsUsd(betBreakdown.totalsAtomic.RED, betBreakdown.currency)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-300">BLACK</span>
                      <span className="font-mono">
                        {formatAtomicAsUsd(betBreakdown.totalsAtomic.BLACK, betBreakdown.currency)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-green-400">GREEN</span>
                      <span className="font-mono">
                        {formatAtomicAsUsd(betBreakdown.totalsAtomic.GREEN, betBreakdown.currency)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-indigo-300">BAIT</span>
                      <span className="font-mono">
                        {formatAtomicAsUsd(betBreakdown.totalsAtomic.BAIT, betBreakdown.currency)}
                      </span>
                    </div>
                  </div>
                </>
              )}
              {round.winningNumber !== null && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Winning Number</span>
                    <span className="font-bold text-lg">{round.winningNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Winning Color</span>
                    <span
                      className={`font-bold ${
                        round.winningColor === "RED"
                          ? "text-red-400"
                          : round.winningColor === "BLACK"
                            ? "text-gray-300"
                            : "text-green-400"
                      }`}
                    >
                      {round.winningColor}
                    </span>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No active round</p>
          )}
        </Card>

        <Card title="Last Result + History (20)">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {lastResult ? (
              <div className="flex flex-col items-center gap-2 py-4">
                <div
                  className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold ${
                    lastResult.color === "RED"
                      ? "bg-red-700"
                      : lastResult.color === "BLACK"
                      ? "bg-gray-800 border border-gray-600"
                      : "bg-emerald-700"
                  }`}
                >
                  {lastResult.number}
                </div>
                <span
                  className={`text-sm font-medium ${
                    lastResult.color === "RED"
                      ? "text-red-400"
                      : lastResult.color === "BLACK"
                      ? "text-gray-300"
                      : "text-green-400"
                  }`}
                >
                  {lastResult.color}
                </span>
              </div>
            ) : (
              <p className="text-gray-500 text-sm text-center py-4">No results yet</p>
            )}

            <div className="max-h-56 overflow-auto space-y-1 pr-1">
              {history.length > 0 ? (
                history.map((item) => (
                  <div
                    key={item.roundId}
                    className="text-xs rounded border border-gray-800 bg-gray-900 px-2 py-1 flex items-center justify-between"
                  >
                    <span className="text-gray-400">#{item.roundNumber}</span>
                    <span
                      className={`font-semibold ${
                        item.winningColor === "RED"
                          ? "text-red-400"
                          : item.winningColor === "BLACK"
                          ? "text-gray-300"
                          : "text-green-400"
                      }`}
                    >
                      {item.winningNumber} {item.winningColor}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-sm text-center py-4">No results yet</p>
              )}
            </div>
          </div>
        </Card>
      </div>

      <Card title="Place Bet">
        <div className="space-y-3">
          <div className="flex gap-2 items-end">
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
            <Input
              label="Stake (USD)"
              value={stakeUsd}
              onChange={(e) => setStakeUsd(e.target.value)}
              placeholder="10.00"
            />
          </div>

          <p className="text-xs text-gray-400">
            BAIT wins when the wheel lands on either number adjacent to GREEN.
          </p>
          <p className="text-xs text-gray-500">1 {currency} ≈ {formatUsd(selectedRate)}</p>

          <div className="flex flex-wrap gap-2">
            {BET_TYPES.map((bt) => (
              <Button
                key={bt}
                variant={
                  bt === "RED"
                    ? "red"
                    : bt === "BLACK"
                      ? "black"
                      : bt === "GREEN"
                        ? "green"
                        : bt === "BAIT"
                          ? "primary"
                        : betType === bt
                          ? "primary"
                          : "secondary"
                }
                className={betType === bt ? "ring-2 ring-indigo-400" : ""}
                onClick={() => setBetType(bt)}
              >
                {bt}
              </Button>
            ))}
          </div>

          <Button onClick={placeBet} disabled={loading || !stakeUsd || round?.status !== "OPEN"}>
            {loading ? "Placing..." : `BET ${betType}`}
          </Button>
        </div>
      </Card>

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
