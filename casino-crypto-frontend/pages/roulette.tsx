import { useEffect, useState, useRef, useCallback } from "react";
import Card from "@/components/Card";
import Button from "@/components/Button";
import Input from "@/components/Input";
import {
  placeRouletteBet,
  getCurrentRound,
  type RouletteRound,
  type RouletteBetResponse,
} from "@/lib/api";
import { CasinoSocket, type SocketEvent, type RouletteRoundEvent } from "@/lib/socket";

const BET_TYPES = ["RED", "BLACK", "GREEN", "BAIT"] as const;
const CURRENCIES = ["USDT", "BTC", "ETH", "USDC"] as const;

export default function RoulettePage() {
  const [round, setRound] = useState<RouletteRound | RouletteRoundEvent | null>(null);
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [currency, setCurrency] = useState<string>("USDT");
  const [stakeAtomic, setStakeAtomic] = useState("1000000");
  const [betType, setBetType] = useState<string>("RED");
  const [response, setResponse] = useState<RouletteBetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState<string>("");
  const [lastResult, setLastResult] = useState<{ number: number | null; color: string | null } | null>(null);

  const socketRef = useRef<CasinoSocket | null>(null);

  const updateCountdown = useCallback(() => {
    if (!round) {
      setCountdown("");
      return;
    }
    const now = Date.now();
    const betsClose = new Date(round.betsCloseAt).getTime();
    const settle = new Date(round.settleAt).getTime();

    if (round.status === "OPEN") {
      const diff = Math.max(0, Math.floor((betsClose - now) / 1000));
      setCountdown(`Bets close in ${diff}s`);
    } else if (round.status === "CLOSED" || round.status === "SPINNING") {
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
    const interval = setInterval(updateCountdown, 500);
    updateCountdown();
    return () => clearInterval(interval);
  }, [updateCountdown]);

  useEffect(() => {
    getCurrentRound(currency).then(setRound).catch(() => {});

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
          setRound(ev.data);
          break;
      }
    });

    sock.connect();
    return () => sock.disconnect();
  }, [currency]);

  const placeBet = async () => {
    setError(null);
    setResponse(null);
    setLoading(true);
    try {
      const res = await placeRouletteBet(
        currency,
        betType,
        stakeAtomic
      );
      setResponse(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bet failed");
    } finally {
      setLoading(false);
    }
  };

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
                <span className="text-gray-400">Timer</span>
                <span className="font-mono text-yellow-300">{countdown}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Total Staked</span>
                <span className="font-mono">{round.totalStakedAtomic}</span>
              </div>
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

        <Card title="Last Result">
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
        </Card>
      </div>

      <Card title="Place Bet">
        <div className="space-y-3">
          <div className="flex gap-2 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-gray-400">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
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
              label="Stake (atomic)"
              value={stakeAtomic}
              onChange={(e) => setStakeAtomic(e.target.value)}
              placeholder="1000000"
            />
          </div>

          <p className="text-xs text-gray-400">
            BAIT wins when the wheel lands on either number adjacent to GREEN.
          </p>

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

          <Button onClick={placeBet} disabled={loading || !stakeAtomic}>
            {loading ? "Placing..." : `BET ${betType}`}
          </Button>
        </div>
      </Card>

      {(response || error) && (
        <Card title="API Response">
          {error && <p className="text-red-400 text-sm mb-2">{error}</p>}
          {response && (
            <pre className="text-xs text-gray-300 overflow-auto max-h-60 bg-gray-800 p-3 rounded">
              {JSON.stringify(response, null, 2)}
            </pre>
          )}
        </Card>
      )}
    </div>
  );
}
