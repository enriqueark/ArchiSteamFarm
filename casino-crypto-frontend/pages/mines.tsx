import { useState } from "react";
import Card from "@/components/Card";
import Button from "@/components/Button";
import Input from "@/components/Input";
import {
  startMinesGame,
  revealMine,
  cashoutMines,
  type MinesGame,
  type MinesRevealResponse,
} from "@/lib/api";

const CURRENCIES = ["USDT", "BTC", "ETH", "USDC"] as const;
const BOARD_SIZE = 25;

type CellState = "hidden" | "safe" | "mine";

export default function MinesPage() {
  const [currency, setCurrency] = useState("USDT");
  const [betAtomic, setBetAtomic] = useState("1000000");
  const [mineCount, setMineCount] = useState("3");
  const [game, setGame] = useState<MinesGame | null>(null);
  const [cells, setCells] = useState<CellState[]>(Array(BOARD_SIZE).fill("hidden"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastReveal, setLastReveal] = useState<MinesRevealResponse["reveal"] | null>(null);
  const [response, setResponse] = useState<string>("");

  const resetBoard = () => {
    setCells(Array(BOARD_SIZE).fill("hidden"));
    setLastReveal(null);
  };

  const handleStart = async () => {
    setError(null);
    setResponse("");
    setLoading(true);
    resetBoard();
    try {
      const g = await startMinesGame(currency, betAtomic, parseInt(mineCount));
      setGame(g);
      setResponse(JSON.stringify(g, null, 2));
      if (g.revealedCells?.length) {
        const next = [...Array(BOARD_SIZE).fill("hidden")] as CellState[];
        g.revealedCells.forEach((idx) => (next[idx] = "safe"));
        setCells(next);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start game");
    } finally {
      setLoading(false);
    }
  };

  const handleReveal = async (cellIndex: number) => {
    if (!game || cells[cellIndex] !== "hidden") return;
    if (game.status !== "ACTIVE") return;
    setError(null);
    setLoading(true);
    try {
      const res = await revealMine(game.gameId, cellIndex);
      setGame(res);
      setLastReveal(res.reveal);
      setResponse(JSON.stringify(res, null, 2));

      const next = [...cells];
      next[cellIndex] = res.reveal.hitMine ? "mine" : "safe";
      if (res.revealedCells?.length) {
        res.revealedCells.forEach((idx) => {
          if (next[idx] === "hidden") next[idx] = "safe";
        });
      }
      setCells(next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Reveal failed");
    } finally {
      setLoading(false);
    }
  };

  const handleCashout = async () => {
    if (!game) return;
    setError(null);
    setLoading(true);
    try {
      const res = await cashoutMines(game.gameId);
      setGame(res);
      setResponse(JSON.stringify(res, null, 2));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Cashout failed");
    } finally {
      setLoading(false);
    }
  };

  const isActive = game?.status === "ACTIVE";

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Mines</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Card title="New Game">
            <div className="space-y-3">
              <div className="flex gap-2 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-sm text-gray-400">Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="bg-surface-200 border border-border rounded-lg px-3 py-2 text-white text-sm"
                    disabled={isActive}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <Input
                  label="Bet (atomic)"
                  value={betAtomic}
                  onChange={(e) => setBetAtomic(e.target.value)}
                  disabled={isActive}
                />
                <Input
                  label="Mines (1-24)"
                  value={mineCount}
                  onChange={(e) => setMineCount(e.target.value)}
                  disabled={isActive}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleStart} disabled={loading || isActive}>
                  {loading && !game ? "Starting..." : "Start Game"}
                </Button>
                {isActive && (
                  <Button variant="success" onClick={handleCashout} disabled={loading}>
                    {loading ? "..." : "CASHOUT"}
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {game && (
            <Card title="Game Info">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Game ID</span>
                  <span className="font-mono text-xs">{game.gameId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Status</span>
                  <span
                    className={`font-medium ${
                      game.status === "ACTIVE"
                        ? "text-green-400"
                        : game.status === "CASHED_OUT"
                          ? "text-indigo-400"
                          : "text-red-400"
                    }`}
                  >
                    {game.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Bet</span>
                  <span className="font-mono">{game.betAtomic}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Mines</span>
                  <span>{game.mineCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Safe Reveals</span>
                  <span>{game.safeReveals}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Multiplier</span>
                  <span className="text-yellow-300 font-mono">{game.currentMultiplier}x</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Potential Payout</span>
                  <span className="font-mono">{game.potentialPayoutAtomic}</span>
                </div>
                {game.payoutAtomic && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Final Payout</span>
                    <span className="font-mono text-green-400">{game.payoutAtomic}</span>
                  </div>
                )}
                {lastReveal && (
                  <div className="mt-2 pt-2 border-t border-border">
                    <p className="text-gray-400 text-xs">Last reveal:</p>
                    <p className="text-xs">
                      Cell {lastReveal.cellIndex} —{" "}
                      <span className={lastReveal.hitMine ? "text-red-400" : "text-green-400"}>
                        {lastReveal.hitMine ? "MINE!" : "Safe"}
                      </span>
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>

        <Card title="Board (5x5)">
          <div className="grid grid-cols-5 gap-2">
            {cells.map((state, idx) => (
              <button
                key={idx}
                onClick={() => handleReveal(idx)}
                disabled={state !== "hidden" || !isActive || loading}
                className={`aspect-square rounded flex items-center justify-center text-lg font-bold transition-all ${
                  state === "hidden"
                    ? isActive
                      ? "bg-surface-300 hover:bg-surface-400 cursor-pointer"
                      : "bg-surface-200 cursor-not-allowed"
                    : state === "safe"
                      ? "bg-green-800 text-green-200"
                      : "bg-red-800 text-red-200"
                }`}
              >
                {state === "hidden" ? "?" : state === "safe" ? "OK" : "X"}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {error && (
        <Card>
          <p className="text-red-400">{error}</p>
        </Card>
      )}

      {response && (
        <Card title="API Response">
          <pre className="text-xs text-gray-300 overflow-auto max-h-60 bg-surface-200 p-3 rounded-lg">
            {response}
          </pre>
        </Card>
      )}
    </div>
  );
}
