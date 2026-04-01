import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
import { useAuthUI } from "@/lib/auth-ui";
import { useToast } from "@/lib/toast";

const INTERNAL_GAME_CURRENCY = "USDT";
const VIRTUAL_CURRENCY_LABEL = "COINS";
const COIN_DECIMALS = 8;
const BOARD_SIZE = 25;
const MAX_BET_COINS = 5000;

type CellState = "hidden" | "safe" | "mine";

export default function MinesPage() {
  const { authed, openAuth } = useAuthUI();
  const { showError, showSuccess } = useToast();
  const [betCoins, setBetCoins] = useState("10.00");
  const [mineCount, setMineCount] = useState("3");
  const [game, setGame] = useState<MinesGame | null>(null);
  const [cells, setCells] = useState<CellState[]>(Array(BOARD_SIZE).fill("hidden"));
  const [loading, setLoading] = useState(false);
  const [lastReveal, setLastReveal] = useState<MinesRevealResponse["reveal"] | null>(null);
  const [response, setResponse] = useState<string>("");
  const [hideExampleData, setHideExampleData] = useState(true);

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
    if (value > MAX_BET_COINS) {
      throw new Error(`Maximum bet is ${MAX_BET_COINS} COINS`);
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
    if (!authed) {
      return;
    }

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
  }, [authed]);

  const handleStart = async () => {
    if (!authed) {
      showError("You need an account to place bets.");
      openAuth("register");
      return;
    }
    setResponse("");
    setLoading(true);
    resetBoard();
    try {
      const g = await startMinesGame(INTERNAL_GAME_CURRENCY, coinsToAtomic(betCoins), parseInt(mineCount));
      setGame(g);
      setResponse(JSON.stringify(g, null, 2));
      hydrateBoardFromGame(g);
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : "Failed to start game");
    } finally {
      setLoading(false);
    }
  };

  const handleReveal = async (cellIndex: number) => {
    if (!authed) {
      showError("You need an account to place bets.");
      openAuth("register");
      return;
    }
    if (!game || cells[cellIndex] !== "hidden") return;
    if (game.status !== "ACTIVE") return;
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
      showError(e instanceof Error ? e.message : "Reveal failed");
    } finally {
      setLoading(false);
    }
  };

  const handleCashout = async () => {
    if (!authed) {
      showError("You need an account to place bets.");
      openAuth("register");
      return;
    }
    if (!game) return;
    setLoading(true);
    try {
      const res = await cashoutMines(game.gameId);
      setGame(res);
      setResponse(JSON.stringify(res, null, 2));
      showSuccess("Cashout successful");
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : "Cashout failed");
    } finally {
      setLoading(false);
    }
  };

  const isActive = game?.status === "ACTIVE";
  const sampleMessages = [
    "oh wow",
    "hola",
    "lets go",
    "nice pull",
    "gg",
    "crazy round"
  ];
  const boardCells = useMemo(
    () =>
      cells.map((state, idx) => {
        if (hideExampleData) {
          return { idx, state };
        }
        if (state !== "hidden") {
          return { idx, state };
        }
        if (idx % 11 === 0) return { idx, state: "mine" as CellState };
        if (idx % 5 === 2) return { idx, state: "safe" as CellState };
        return { idx, state };
      }),
    [cells, hideExampleData]
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[250px_minmax(0,1fr)]">
        <Card className="border-[#1f2535] bg-[#0b0e14] p-3">
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-gray-500">Games</p>
          <nav className="space-y-1 text-sm">
            <Link href="/cases" className="block rounded px-2 py-2 text-gray-400 transition hover:bg-white/5 hover:text-white">
              Cases
            </Link>
            <Link href="/roulette" className="block rounded px-2 py-2 text-gray-400 transition hover:bg-white/5 hover:text-white">
              Roulette
            </Link>
            <span className="block rounded border border-red-500/40 bg-red-500/10 px-2 py-2 font-semibold text-red-200">
              Mines
            </span>
            <Link href="/blackjack" className="block rounded px-2 py-2 text-gray-400 transition hover:bg-white/5 hover:text-white">
              Blackjack
            </Link>
          </nav>
        </Card>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
            <Card className="border-[#1f2535] bg-[#0b0e14] p-3">
              <h1 className="text-xl font-bold text-white">Mines</h1>
              <p className="mt-1 text-xs text-gray-500">Figma-style UI + real game logic</p>

              <div className="mt-3 space-y-2">
                <Input
                  label={`Bet (${VIRTUAL_CURRENCY_LABEL})`}
                  value={betCoins}
                  onChange={(e) => setBetCoins(e.target.value)}
                  disabled={isActive}
                  className="bg-[#101420] border-[#283247]"
                />
                <Input
                  label="Mines (1-24)"
                  value={mineCount}
                  onChange={(e) => setMineCount(e.target.value)}
                  disabled={isActive}
                  className="bg-[#101420] border-[#283247]"
                />
              </div>

              <div className="mt-3 flex gap-2">
                <Button
                  className="flex-1 bg-red-600 hover:bg-red-500"
                  onClick={handleStart}
                  disabled={loading || isActive}
                >
                  {loading && !game ? "Starting..." : "Bet"}
                </Button>
                {isActive && (
                  <Button variant="success" className="flex-1" onClick={handleCashout} disabled={loading}>
                    {loading ? "..." : "Cashout"}
                  </Button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setHideExampleData((prev) => !prev)}
                className="mt-3 text-xs text-gray-400 underline underline-offset-2"
              >
                {hideExampleData ? "Show example board highlights" : "Hide example board highlights"}
              </button>

              {game && (
                <div className="mt-3 rounded border border-[#283247] bg-[#101420] p-2 text-xs text-gray-300">
                  <p>Game ID: {game.gameId.slice(0, 10)}...</p>
                  <p>Status: {game.status}</p>
                  <p>Multiplier: {game.currentMultiplier}x</p>
                  <p>
                    Potential: {atomicToCoins(game.potentialPayoutAtomic)} {VIRTUAL_CURRENCY_LABEL}
                  </p>
                  {lastReveal ? (
                    <p className={lastReveal.hitMine ? "text-red-300" : "text-green-300"}>
                      Last: cell {lastReveal.cellIndex} {lastReveal.hitMine ? "MINE" : "SAFE"}
                    </p>
                  ) : null}
                </div>
              )}
            </Card>

            <Card className="border-[#1f2535] bg-[#0b0e14] p-3">
              <div className="grid grid-cols-5 gap-2">
                {boardCells.map(({ state, idx }) => (
                  <button
                    key={idx}
                    onClick={() => handleReveal(idx)}
                    disabled={state !== "hidden" || !isActive || loading}
                    className={`aspect-square rounded-md border text-sm font-bold transition ${
                      state === "hidden"
                        ? isActive
                          ? "border-[#2b3446] bg-[#111723] text-gray-300 hover:border-red-400/40 hover:bg-[#171f2d]"
                          : "border-[#222b3a] bg-[#0f1520] text-gray-600"
                        : state === "safe"
                          ? "border-green-500/50 bg-green-500/20 text-green-200"
                          : "border-red-500/50 bg-red-500/20 text-red-200"
                    }`}
                  >
                    {state === "hidden" ? "?" : state === "safe" ? "🍀" : "💣"}
                  </button>
                ))}
              </div>
            </Card>
          </div>

          <Card className="border-[#1f2535] bg-[#0b0e14] p-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Chat example panel</h2>
              <span className="text-xs text-gray-500">UI preview style</span>
            </div>
            <div className="mt-2 grid gap-1 rounded border border-[#283247] bg-[#101420] p-2 text-xs">
              {sampleMessages.map((msg, i) => (
                <p key={i} className="text-gray-300">
                  <span className="mr-1 text-red-300">user{i + 1}:</span>
                  {msg}
                </p>
              ))}
            </div>
          </Card>

          {response && (
            <Card title="API Response (debug)" className="border-[#1f2535] bg-[#0b0e14]">
              <pre className="max-h-60 overflow-auto rounded bg-[#101420] p-3 text-xs text-gray-300">{response}</pre>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
