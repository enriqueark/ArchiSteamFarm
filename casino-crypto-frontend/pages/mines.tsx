import { useState } from "react";
import {
  startMinesGame,
  revealMine,
  cashoutMines,
  type MinesGame,
  type MinesRevealResponse,
} from "@/lib/api";

const CURRENCIES = ["USDT", "BTC", "ETH", "USDC"] as const;
const BOARD_SIZE = 25;
const MINE_PRESETS = [1, 3, 5, 10, 24];

const HIDDEN_TILE = "/assets/09d0723a9bfccbed73637ba3ba799693.svg";
const GEM_ICON = "/assets/7314404ef65e3d5b3dc26009de5d710c.svg";

type CellState = "hidden" | "safe" | "mine";

function formatAtomic(val: string, decimals = 6): string {
  return (Number(val) / Math.pow(10, decimals)).toFixed(2);
}

export default function MinesPage() {
  const [currency, setCurrency] = useState("USDT");
  const [betAtomic, setBetAtomic] = useState("1000000");
  const [mineCount, setMineCount] = useState(3);
  const [game, setGame] = useState<MinesGame | null>(null);
  const [cells, setCells] = useState<CellState[]>(Array(BOARD_SIZE).fill("hidden"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastReveal, setLastReveal] = useState<MinesRevealResponse["reveal"] | null>(null);

  const isActive = game?.status === "ACTIVE";

  const resetBoard = () => {
    setCells(Array(BOARD_SIZE).fill("hidden"));
    setLastReveal(null);
  };

  const handleStart = async () => {
    setError(null);
    setLoading(true);
    resetBoard();
    try {
      const g = await startMinesGame(currency, betAtomic, mineCount);
      setGame(g);
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
    if (!game || cells[cellIndex] !== "hidden" || !isActive) return;
    setError(null);
    setLoading(true);
    try {
      const res = await revealMine(game.gameId, cellIndex);
      setGame(res);
      setLastReveal(res.reveal);
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Cashout failed");
    } finally {
      setLoading(false);
    }
  };

  const handlePickRandom = () => {
    if (!isActive) return;
    const hidden = cells.map((s, i) => (s === "hidden" ? i : -1)).filter((i) => i >= 0);
    if (hidden.length === 0) return;
    const pick = hidden[Math.floor(Math.random() * hidden.length)];
    handleReveal(pick);
  };

  return (
    <div className="flex gap-5 max-w-[1300px] mx-auto">
      {/* Left panel — controls */}
      <div
        className="w-[401px] shrink-0 rounded-card p-5 flex flex-col gap-4"
        style={{ background: "linear-gradient(180deg, #161616 0%, #0d0d0d 100%)" }}
      >
        {/* Bet amount */}
        <div>
          <label className="text-sm text-muted mb-2 block">Bet amount</label>
          <div className="flex items-center gap-2 bg-[#090909] rounded-[14px] p-1.5">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={isActive}
              className="bg-transparent text-white text-sm px-2 py-2 outline-none"
            >
              {CURRENCIES.map((c) => <option key={c} value={c} className="bg-[#090909]">{c}</option>)}
            </select>
            <input
              value={betAtomic}
              onChange={(e) => setBetAtomic(e.target.value)}
              disabled={isActive}
              className="flex-1 bg-transparent text-white text-sm font-medium outline-none text-right"
              placeholder="1000000"
            />
            <button
              onClick={() => setBetAtomic(String(Math.floor(Number(betAtomic) / 2)))}
              disabled={isActive}
              className="px-3 py-1.5 rounded-btn bg-[#1a1a1a] text-xs text-muted font-medium shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424] disabled:opacity-30"
            >
              1/2
            </button>
            <button
              onClick={() => setBetAtomic(String(Number(betAtomic) * 2))}
              disabled={isActive}
              className="px-3 py-1.5 rounded-btn bg-[#1a1a1a] text-xs text-muted font-medium shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424] disabled:opacity-30"
            >
              x2
            </button>
          </div>
        </div>

        {/* Divider */}
        <hr className="border-[#1e1e1e]" />

        {/* Number of mines */}
        <div>
          <label className="text-sm text-muted mb-2 block">Number of mines</label>
          <div className="flex items-center gap-2 bg-[#090909] rounded-[14px] p-1.5">
            <span className="flex-1 px-3 py-2 text-white text-sm font-medium">{mineCount}</span>
            {MINE_PRESETS.map((n) => (
              <button
                key={n}
                onClick={() => setMineCount(n)}
                disabled={isActive}
                className={`px-3 py-1.5 rounded-btn text-xs font-medium transition-all disabled:opacity-30 ${
                  mineCount === n
                    ? "bg-gradient-to-b from-[#ac2e30] to-[#f75154] text-white shadow-[inset_0_1px_0_#f24f51,inset_0_-1px_0_#ff7476]"
                    : "bg-[#1a1a1a] text-muted shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424]"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <hr className="border-[#1e1e1e]" />

        {/* Multiplier display */}
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-4">
          {game ? (
            <>
              <div className="px-4 py-2 rounded-btn bg-gradient-to-b from-[#ac2e30] to-[#f75154] shadow-[inset_0_1px_0_#f24f51,inset_0_-1px_0_#ff7476]">
                <span className="text-white text-lg font-bold">x{game.currentMultiplier}</span>
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm text-muted">Potential payout</p>
                <p className="text-xl font-bold text-accent-green">
                  ${formatAtomic(game.potentialPayoutAtomic)}
                </p>
              </div>
              {game.payoutAtomic && game.status !== "ACTIVE" && (
                <div className="text-center">
                  <p className="text-sm text-muted">Final payout</p>
                  <p className="text-2xl font-bold text-accent-green">${formatAtomic(game.payoutAtomic)}</p>
                </div>
              )}
              <div className="flex gap-2 text-xs text-muted">
                <span>Safe: {game.safeReveals}</span>
                <span>Mines: {game.mineCount}</span>
                <span className={`font-medium ${
                  game.status === "ACTIVE" ? "text-accent-green" : game.status === "CASHED_OUT" ? "text-accent-blue" : "text-red-400"
                }`}>{game.status}</span>
              </div>
            </>
          ) : (
            <div className="text-center">
              <img src="/assets/4e425b7d3c328e970651b77449845d15.png" alt="" className="w-32 h-32 object-contain mx-auto opacity-40 mb-3" />
              <p className="text-muted text-sm">Set your bet and start the game</p>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-[#2a1015] border border-[#5c1a20] rounded-btn px-3 py-2">
            <p className="text-red-400 text-xs">{error}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          {isActive ? (
            <>
              <button
                onClick={handlePickRandom}
                disabled={loading}
                className="w-full py-3.5 rounded-btn bg-[#1a1a1a] text-white text-sm font-medium shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424] hover:bg-[#222] transition-colors disabled:opacity-50"
              >
                Pick random tile
              </button>
              <button
                onClick={handleCashout}
                disabled={loading}
                className="w-full py-3.5 rounded-btn bg-gradient-to-b from-[#51ee5c] to-[#37823c] text-[#0d280f] text-sm font-bold shadow-[0_2px_0_#0d2a0f,inset_0_1px_0_rgba(255,255,255,0.15)] hover:brightness-110 transition-all disabled:opacity-50"
              >
                Cashout ${game ? formatAtomic(game.potentialPayoutAtomic) : "0.00"}
              </button>
            </>
          ) : (
            <button
              onClick={handleStart}
              disabled={loading || !betAtomic}
              className="w-full py-3.5 rounded-btn bg-gradient-to-b from-[#ac2e30] to-[#f75154] text-white text-sm font-bold shadow-[inset_0_1px_0_#f24f51,inset_0_-1px_0_#ff7476] hover:brightness-110 transition-all disabled:opacity-50"
            >
              {loading ? "Starting..." : "Start game"}
            </button>
          )}
        </div>
      </div>

      {/* Right panel — 5x5 board */}
      <div
        className="flex-1 rounded-card p-8 flex items-center justify-center"
        style={{ background: "linear-gradient(180deg, #161616 0%, #0d0d0d 100%)" }}
      >
        <div className="flex flex-wrap gap-3" style={{ width: "583px" }}>
          {cells.map((state, idx) => (
            <button
              key={idx}
              onClick={() => handleReveal(idx)}
              disabled={state !== "hidden" || !isActive || loading}
              className={`w-[107px] h-[107px] rounded-btn flex items-center justify-center transition-all ${
                state === "hidden"
                  ? isActive
                    ? "cursor-pointer hover:brightness-125 hover:scale-[1.03]"
                    : "cursor-default opacity-60"
                  : ""
              }`}
              style={
                state === "safe"
                  ? { background: "linear-gradient(180deg, #51ee5c 0%, #37823c 100%)", boxShadow: "0 2px 0 0 #0d2a0f, inset 0 2px 0 0 rgba(255,255,255,0.07)" }
                  : state === "mine"
                    ? { background: "linear-gradient(180deg, #f75154 0%, #ac2e30 100%)", boxShadow: "0 2px 0 0 #2a0d0d, inset 0 2px 0 0 rgba(255,255,255,0.07)" }
                    : undefined
              }
            >
              {state === "hidden" ? (
                <img src={HIDDEN_TILE} alt="" className="w-full h-full" />
              ) : state === "safe" ? (
                <div className="flex flex-col items-center gap-1">
                  <img src={GEM_ICON} alt="gem" className="w-10 h-9" />
                  {game && (
                    <span className="text-[11px] font-bold text-[#0d280f]">
                      ${formatAtomic(game.potentialPayoutAtomic)}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-3xl">💣</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
