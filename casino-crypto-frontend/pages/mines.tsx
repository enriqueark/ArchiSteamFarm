import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  const boardCells = useMemo(
    () =>
      cells.map((state, idx) => {
        if (state !== "hidden") {
          return { idx, state };
        }
        return { idx, state };
      }),
    [cells]
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-3">
        <aside className="rounded-lg border border-[#171c28] bg-[#090d14] p-3">
          <nav className="space-y-1 text-sm">
            <Link href="/cases" className="block rounded px-2 py-2 text-gray-400 transition hover:bg-white/5 hover:text-white">
              CASES
            </Link>
            <Link href="/battles" className="block rounded px-2 py-2 text-gray-400 transition hover:bg-white/5 hover:text-white">
              CASE BATTLE
            </Link>
            <Link href="/roulette" className="block rounded px-2 py-2 text-gray-400 transition hover:bg-white/5 hover:text-white">
              ROULETTE
            </Link>
            <span className="block rounded border border-red-500/40 bg-red-500/15 px-2 py-2 font-semibold text-red-200">MINES</span>
            <Link href="/blackjack" className="block rounded px-2 py-2 text-gray-400 transition hover:bg-white/5 hover:text-white">
              BLACKJACK
            </Link>
          </nav>
        </aside>

        <div className="space-y-3">
          <div className="grid grid-cols-[214px_minmax(0,1fr)] gap-3">
            <section className="rounded-lg border border-[#171c28] bg-[#0a0f17] p-3">
              <p className="text-[11px] text-gray-500">Bet amount</p>
              <div className="mt-1 flex items-center gap-1">
                <Input
                  value={betCoins}
                  onChange={(e) => setBetCoins(e.target.value)}
                  disabled={isActive}
                  className="h-8 border-[#1f2634] bg-[#111824] text-sm"
                />
                <button className="h-8 rounded bg-[#171e2a] px-2 text-xs text-gray-300">1/2</button>
                <button className="h-8 rounded bg-[#171e2a] px-2 text-xs text-gray-300">Max</button>
              </div>
              <div className="mt-2 h-1.5 rounded bg-[#2a2f3d]">
                <div className="h-1.5 w-[92%] rounded bg-[#e34a52]" />
              </div>

              <p className="mt-3 text-[11px] text-gray-500">Number of mines</p>
              <Input
                value={mineCount}
                onChange={(e) => setMineCount(e.target.value)}
                disabled={isActive}
                className="mt-1 h-8 border-[#1f2634] bg-[#111824] text-sm"
              />
              <div className="mt-2 grid grid-cols-5 gap-1">
                {[1, 3, 5, 10, 24].map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={`h-7 rounded text-xs ${Number(mineCount) === count ? "bg-[#262f40] text-white" : "bg-[#141b27] text-gray-400"}`}
                    onClick={() => setMineCount(String(count))}
                    disabled={isActive}
                  >
                    {count}
                  </button>
                ))}
              </div>

              <div className="mt-3 rounded border border-[#30212b] bg-gradient-to-b from-[#1a1016] to-[#0f121a] p-2">
                <div className="flex h-[130px] items-center justify-center rounded border border-red-500/20 bg-[#101722] text-7xl">🧿</div>
                <div className="mt-2 inline-flex rounded bg-red-500/90 px-2 py-0.5 text-xs font-semibold text-white">
                  x{game?.currentMultiplier ?? "0.92"}
                </div>
              </div>

              <button className="mt-2 h-9 w-full rounded bg-[#171e2a] text-sm font-medium text-gray-400">Pick random tile</button>
              <button
                className="mt-2 h-9 w-full rounded bg-gradient-to-r from-[#e4414b] to-[#ff5963] text-sm font-semibold text-white"
                onClick={isActive ? handleCashout : handleStart}
                disabled={loading}
              >
                {isActive
                  ? `Cashout $${atomicToCoins(game?.potentialPayoutAtomic ?? "0")}`
                  : loading
                  ? "Starting..."
                  : "Start"}
              </button>
            </section>

            <section className="rounded-lg border border-[#171c28] bg-[#0a0f17] p-4">
              <div className="mx-auto grid max-w-[520px] grid-cols-5 gap-2.5">
                {boardCells.map(({ state, idx }) => (
                  <button
                    key={idx}
                    onClick={() => handleReveal(idx)}
                    disabled={state !== "hidden" || !isActive || loading}
                    className={`aspect-square rounded-md border text-sm font-bold transition ${
                      state === "hidden"
                        ? isActive
                          ? "border-[#2b3446] bg-[#121823] text-gray-300 hover:border-red-400/40 hover:bg-[#171f2d]"
                          : "border-[#222b3a] bg-[#101721] text-gray-600"
                        : state === "safe"
                        ? "border-green-500/40 bg-[#3ed156] text-[#0b2612]"
                        : "border-red-500/40 bg-[#e2464f] text-[#3c0e12]"
                    }`}
                  >
                    {state === "hidden" ? "✹" : state === "safe" ? "◈" : "☀"}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <footer className="rounded-lg border border-[#171c28] bg-[#080b12] px-4 py-5">
            <div className="grid grid-cols-5 gap-6">
              <div>
                <p className="text-3xl font-black italic text-white">REDWATER</p>
                <p className="mt-2 text-xs text-gray-500">© All rights reserved 2026</p>
                <p className="mt-2 text-xs text-gray-600">support: support@redwater.gg</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Games</p>
                <ul className="mt-2 space-y-1 text-sm text-gray-500">
                  <li>Cases</li>
                  <li>Case Battles</li>
                  <li>Roulette</li>
                  <li>Mines</li>
                  <li>BlackJack</li>
                </ul>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Platform</p>
                <ul className="mt-2 space-y-1 text-sm text-gray-500">
                  <li>Rewards</li>
                  <li>Affiliates</li>
                  <li>Blog</li>
                  <li>Support</li>
                  <li>FAQ</li>
                </ul>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">About us</p>
                <ul className="mt-2 space-y-1 text-sm text-gray-500">
                  <li>Terms of Service</li>
                  <li>Privacy Policy</li>
                  <li>AML Policy</li>
                  <li>Cookies Policy</li>
                  <li>Fairness</li>
                </ul>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Community</p>
                <ul className="mt-2 space-y-1 text-sm text-gray-500">
                  <li>Twitter</li>
                  <li>Discord</li>
                  <li>Telegram</li>
                  <li>Kick</li>
                </ul>
              </div>
            </div>
          </footer>
        </div>
      </div>

      {response && (
        <details className="rounded border border-[#171c28] bg-[#0a0f17] p-3 text-xs text-gray-400">
          <summary className="cursor-pointer select-none">API response (debug)</summary>
          <pre className="mt-2 max-h-60 overflow-auto rounded bg-[#101420] p-3 text-xs text-gray-300">{response}</pre>
        </details>
      )}
    </div>
  );
}
