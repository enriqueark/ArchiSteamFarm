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
const BOMB_ICON = "/assets/c4b1622f42a16ecfa9bd80339816d0f1.png";
const WEAPON_ART = "/assets/4e425b7d3c328e970651b77449845d15.png";
const RAIL_LEFT = "/assets/53afd2537d26b04bd54b538a8d997e24.svg";
const RAIL_RIGHT = "/assets/b4fbfa3ebe2ac32ca7bc3136b2647ee7.svg";
const DIVIDER_SVG = "/assets/5edaa698796fe2f18fcc3c6a7ec12584.svg";

type CellState = "hidden" | "safe" | "mine";

function fmtCoins(val: string | null | undefined, decimals = 6): string {
  if (!val) return "0.00";
  const n = Number(val) / Math.pow(10, decimals);
  if (isNaN(n)) return "0.00";
  return n.toFixed(2);
}

function fmtMultiplier(val: string | null | undefined): string {
  if (!val) return "0.00";
  const n = parseFloat(val);
  if (isNaN(n)) return "0.00";
  return n.toFixed(2);
}

export default function MinesPage() {
  const [currency, setCurrency] = useState("USDT");
  const [betAtomic, setBetAtomic] = useState("1000000");
  const [mineCount, setMineCount] = useState(3);
  const [game, setGame] = useState<MinesGame | null>(null);
  const [cells, setCells] = useState<CellState[]>(Array(BOARD_SIZE).fill("hidden"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setLastReveal] = useState<MinesRevealResponse["reveal"] | null>(null);

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

  const safeCount = cells.filter((c) => c === "safe").length;
  const totalSafe = BOARD_SIZE - mineCount;
  const progress = isActive ? (safeCount / totalSafe) * 100 : 0;

  return (
    <div className="flex gap-5 max-w-[1300px] mx-auto">
      {/* ── Left panel ── */}
      <div className="w-[401px] shrink-0 rounded-card flex flex-col" style={{ background: "linear-gradient(180deg, #161616 0%, #0d0d0d 100%)" }}>
        <div className="p-5 flex flex-col gap-4">
          {/* Bet amount */}
          <div>
            <p className="text-sm text-muted mb-2">Bet amount</p>
            <div className="flex items-center bg-[#090909] rounded-[14px] h-[54px] px-1.5 gap-1.5">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={isActive}
                className="bg-transparent text-white text-sm font-medium px-2 outline-none appearance-none cursor-pointer"
              >
                {CURRENCIES.map((c) => <option key={c} value={c} className="bg-[#090909]">{c}</option>)}
              </select>
              <input
                value={betAtomic}
                onChange={(e) => setBetAtomic(e.target.value)}
                disabled={isActive}
                className="flex-1 bg-transparent text-white text-sm font-medium outline-none text-right min-w-0"
                placeholder="1000000"
              />
              <button
                onClick={() => setBetAtomic(String(Math.floor(Number(betAtomic) / 2)))}
                disabled={isActive}
                className="h-[42px] px-3 rounded-btn bg-[#1a1a1a] text-xs text-muted font-medium shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424] disabled:opacity-30"
              >
                1/2
              </button>
              <button
                disabled={isActive}
                className="h-[42px] px-3 rounded-btn bg-[#1a1a1a] text-xs text-muted font-medium shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424] disabled:opacity-30"
              >
                Max
              </button>
            </div>
          </div>

          {/* Red progress bar */}
          <div className="h-1 rounded-full bg-[#1a1a1a] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progress}%`, background: "linear-gradient(90deg, #ac2e30, #f75154)" }}
            />
          </div>

          {/* Divider SVG */}
          <img src={DIVIDER_SVG} alt="" className="w-full opacity-30" />

          {/* Number of mines */}
          <div>
            <p className="text-sm text-muted mb-2">Number of mines</p>
            <div className="flex items-center bg-[#090909] rounded-[14px] h-[54px] px-1.5 gap-1.5">
              <div className="h-[42px] px-4 rounded-btn bg-[#1a1a1a] flex items-center shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424]">
                <span className="text-white text-sm font-medium">{mineCount}</span>
              </div>
              <div className="flex-1" />
              {MINE_PRESETS.map((n) => (
                <button
                  key={n}
                  onClick={() => setMineCount(n)}
                  disabled={isActive}
                  className={`h-[42px] min-w-[42px] px-2 rounded-btn text-xs font-medium transition-all disabled:opacity-30 ${
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
        </div>

        {/* Multiplier / weapon art area */}
        <div className="flex-1 relative flex flex-col items-center justify-center px-5 overflow-hidden" style={{ background: "linear-gradient(180deg, #282828 0%, #1a1a1a 100%)" }}>
          <img src={RAIL_LEFT} alt="" className="absolute left-3 top-1/2 -translate-y-1/2 h-3/4 opacity-40" />
          <img src={RAIL_RIGHT} alt="" className="absolute right-3 top-1/2 -translate-y-1/2 h-3/4 opacity-40" />

          <img
            src={WEAPON_ART}
            alt=""
            className="w-[220px] h-[220px] object-contain relative z-10"
            style={{ transform: "rotate(12.9deg)" }}
          />

          <div className="relative z-10 mt-3 px-3 py-1.5 rounded-btn bg-gradient-to-b from-[#ac2e30] to-[#f75154] shadow-[inset_0_1px_0_#f24f51,inset_0_-1px_0_#ff7476]">
            <span className="text-white text-sm font-bold">x{fmtMultiplier(game?.currentMultiplier)}</span>
          </div>

          {game && (
            <div className="relative z-10 mt-2 text-center">
              <p className="text-xs text-muted">Potential payout</p>
              <p className="text-lg font-bold text-accent-green">${fmtCoins(game.potentialPayoutAtomic)}</p>
              {game.status !== "ACTIVE" && (
                <p className={`text-xs font-medium mt-1 ${game.status === "CASHED_OUT" ? "text-accent-green" : "text-red-400"}`}>
                  {game.status === "CASHED_OUT" ? "Cashed out!" : "Game over"}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Bottom buttons */}
        <div className="p-5 flex flex-col gap-2">
          {error && (
            <div className="bg-[#2a1015] border border-[#5c1a20] rounded-btn px-3 py-2 mb-1">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          {isActive ? (
            <>
              <button
                onClick={handlePickRandom}
                disabled={loading}
                className="w-full h-[52px] rounded-btn bg-[#1a1a1a] text-white text-sm font-medium shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424] hover:bg-[#222] transition-colors disabled:opacity-50"
              >
                Pick random tile
              </button>
              <button
                onClick={handleCashout}
                disabled={loading}
                className="w-full h-[52px] rounded-btn bg-gradient-to-b from-[#51ee5c] to-[#37823c] text-[#0d280f] text-sm font-bold shadow-[0_2px_0_#0d2a0f,inset_0_1px_0_rgba(255,255,255,0.15)] hover:brightness-110 transition-all disabled:opacity-50"
              >
                Cashout ${fmtCoins(game?.potentialPayoutAtomic || "0")}
              </button>
            </>
          ) : (
            <button
              onClick={handleStart}
              disabled={loading || !betAtomic}
              className="w-full h-[52px] rounded-btn bg-gradient-to-b from-[#ac2e30] to-[#f75154] text-white text-sm font-bold shadow-[inset_0_1px_0_#f24f51,inset_0_-1px_0_#ff7476] hover:brightness-110 transition-all disabled:opacity-50"
            >
              {loading ? "Starting..." : "Start game"}
            </button>
          )}
        </div>
      </div>

      {/* ── Right: 5×5 board ── */}
      <div
        className="flex-1 rounded-card flex items-center justify-center p-8"
        style={{ background: "linear-gradient(180deg, #161616 0%, #0d0d0d 100%)" }}
      >
        <div className="flex flex-wrap gap-3" style={{ width: "583px" }}>
          {cells.map((state, idx) => (
            <button
              key={idx}
              onClick={() => handleReveal(idx)}
              disabled={state !== "hidden" || !isActive || loading}
              className="w-[107px] h-[107px] rounded-btn flex flex-col items-center justify-center transition-all"
              style={
                state === "safe"
                  ? { background: "linear-gradient(180deg, #51ee5c 0%, #37823c 100%)", boxShadow: "0 2px 0 0 #0d2a0f, inset 0 2px 2.5px rgba(0,0,0,0.25), inset 0 -1px 0 0 #50e95a" }
                  : state === "mine"
                    ? { background: "linear-gradient(180deg, #f75154 0%, #ac2e30 100%)", boxShadow: "0 2px 0 0 #2a0d0d, inset 0 2px 0 0 rgba(255,255,255,0.07)" }
                    : undefined
              }
            >
              {state === "hidden" ? (
                <img
                  src={HIDDEN_TILE}
                  alt=""
                  className={`w-full h-full ${isActive ? "cursor-pointer hover:brightness-125" : "opacity-50"}`}
                />
              ) : state === "safe" ? (
                <>
                  <img src={GEM_ICON} alt="gem" className="w-[42px] h-[36px]" />
                  <span className="text-[11px] font-bold text-[#0d280f] mt-0.5">
                    ${fmtCoins(game?.potentialPayoutAtomic)}
                  </span>
                </>
              ) : (
                <img src={BOMB_ICON} alt="mine" className="w-[50px] h-[50px] object-contain" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
