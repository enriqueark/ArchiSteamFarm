import { useEffect, useState } from "react";
import Card from "@/components/Card";
import Button from "@/components/Button";
import Input from "@/components/Input";
import {
  getActiveMinesGame,
  startMinesGame,
  revealMine,
  cashoutMines,
  type MinesGame,
  type MinesRevealResponse,
} from "@/lib/api";

const INTERNAL_GAME_CURRENCY = "USDT";
const VIRTUAL_CURRENCY_LABEL = "COINS";
const COIN_DECIMALS = 8;
const BOARD_SIZE = 25;

type CellState = "hidden" | "safe" | "mine";

export default function MinesPage() {
  const [betCoins, setBetCoins] = useState("10.00");
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

  const atomicToCoins = (atomic: string): string => {
    const value = Number(atomic);
    if (!Number.isFinite(value)) {
      return "0.00";
    }
    return (value / 10 ** COIN_DECIMALS).toFixed(2);
  };

  const coinsToAtomic = (coinsRaw: string): string => {
    const value = Number(coinsRaw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("Bet must be a positive COINS value");
    }
    return String(Math.round(value * 10 ** COIN_DECIMALS));
  };

  const hydrateBoardFromGame = (g: MinesGame) => {
    const next = [...Array(BOARD_SIZE).fill("hidden")] as CellState[];
    g.revealedCells?.forEach((idx) => {
      next[idx] = "safe";
    });
    setCells(next);
  };

  useEffect(() => {
    let cancelled = false;

    const loadActiveGame = async () => {
      try {
        const active = await getActiveMinesGame();
        if (cancelled || !active) {
          return;
        }

        setGame(active);
        setBetCoins(atomicToCoins(active.betAtomic));
        setMineCount(String(active.mineCount));
        hydrateBoardFromGame(active);
        setResponse(JSON.stringify(active, null, 2));
      } catch {
        // Ignore on page load; user might be logged out or have no session yet.
      }
    };

    void loadActiveGame();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleStart = async () => {
    setError(null);
    setResponse("");
    setLoading(true);
    resetBoard();
    try {
      const g = await startMinesGame(INTERNAL_GAME_CURRENCY, coinsToAtomic(betCoins), parseInt(mineCount));
      setGame(g);
      setResponse(JSON.stringify(g, null, 2));
      hydrateBoardFromGame(g);
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
                <Input
                  label={`Bet (${VIRTUAL_CURRENCY_LABEL})`}
                  value={betCoins}
                  onChange={(e) => setBetCoins(e.target.value)}
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
                  <span className="font-mono">
                    {atomicToCoins(game.betAtomic)} {VIRTUAL_CURRENCY_LABEL}
                  </span>
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
                  <span className="font-mono">
                    {atomicToCoins(game.potentialPayoutAtomic)} {VIRTUAL_CURRENCY_LABEL}
                  </span>
                </div>
                {game.payoutAtomic && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Final Payout</span>
                    <span className="font-mono text-green-400">
                      {atomicToCoins(game.payoutAtomic)} {VIRTUAL_CURRENCY_LABEL}
                    </span>
                  </div>
                )}
                {lastReveal && (
                  <div className="mt-2 pt-2 border-t border-gray-800">
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
                      ? "bg-gray-700 hover:bg-gray-600 cursor-pointer"
                      : "bg-gray-800 cursor-not-allowed"
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
          <pre className="text-xs text-gray-300 overflow-auto max-h-60 bg-gray-800 p-3 rounded">
            {response}
          </pre>
        </Card>
      )}
    </div>
  );
}
