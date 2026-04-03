import { useState } from "react";
import {
  startMinesGame,
  revealMine,
  cashoutMines,
  type MinesGame,
  type MinesRevealResponse,
} from "@/lib/api";

const BOARD_SIZE = 25;
const MINE_PRESETS = [1, 3, 5, 10, 24];
const CURRENCIES = ["USDT", "BTC", "ETH", "USDC"] as const;

const A = "/assets/";
const HIDDEN_TILE = `${A}09d0723a9bfccbed73637ba3ba799693.svg`;
const GEM_SVG = `${A}7314404ef65e3d5b3dc26009de5d710c.svg`;
const DIVIDER = `${A}5edaa698796fe2f18fcc3c6a7ec12584.svg`;
const RAIL_L = `${A}53afd2537d26b04bd54b538a8d997e24.svg`;
const RAIL_R = `${A}b4fbfa3ebe2ac32ca7bc3136b2647ee7.svg`;
const POLY1 = `${A}b6d6c3347b8703c97896883a1403de0b.svg`;
const POLY2 = `${A}6b1afbc61c27e477151d378fd42686be.svg`;
const POLY3 = `${A}48299ac45bc8c79776e03a90ed321ed3.svg`;
const WEAPON = `${A}4e425b7d3c328e970651b77449845d15.png`;
const BOMB = `${A}c4b1622f42a16ecfa9bd80339816d0f1.png`;

type CellState = "hidden" | "safe" | "mine";

function fmt(val: string | null | undefined, d = 6): string {
  if (!val) return "0.00";
  const n = Number(val) / 10 ** d;
  return isNaN(n) ? "0.00" : n.toFixed(2);
}
function fmtMul(val: string | null | undefined): string {
  if (!val) return "0.00";
  const n = parseFloat(val);
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

export default function MinesPage() {
  const [currency, setCurrency] = useState("USDT");
  const [betInput, setBetInput] = useState("0.12");
  const [mineCount, setMineCount] = useState(1);
  const [game, setGame] = useState<MinesGame | null>(null);
  const [cells, setCells] = useState<CellState[]>(Array(BOARD_SIZE).fill("hidden"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActive = game?.status === "ACTIVE";
  const betAtomic = String(Math.round(parseFloat(betInput || "0") * 1e6));

  const reset = () => setCells(Array(BOARD_SIZE).fill("hidden"));

  const start = async () => {
    setError(null); setLoading(true); reset();
    try {
      const g = await startMinesGame(currency, betAtomic, mineCount);
      setGame(g);
      if (g.revealedCells?.length) {
        const n = Array(BOARD_SIZE).fill("hidden") as CellState[];
        g.revealedCells.forEach((i) => (n[i] = "safe"));
        setCells(n);
      }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  };

  const reveal = async (idx: number) => {
    if (!game || cells[idx] !== "hidden" || !isActive) return;
    setError(null); setLoading(true);
    try {
      const r = await revealMine(game.gameId, idx);
      setGame(r);
      const n = [...cells];
      n[idx] = r.reveal.hitMine ? "mine" : "safe";
      r.revealedCells?.forEach((i) => { if (n[i] === "hidden") n[i] = "safe"; });
      setCells(n);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  };

  const cashout = async () => {
    if (!game) return;
    setError(null); setLoading(true);
    try { setGame(await cashoutMines(game.gameId)); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  };

  const pickRandom = () => {
    if (!isActive) return;
    const h = cells.map((s, i) => s === "hidden" ? i : -1).filter((i) => i >= 0);
    if (h.length) reveal(h[Math.floor(Math.random() * h.length)]);
  };

  const payoutStr = game ? "$" + fmt(game.potentialPayoutAtomic) : "$0.00";

  /* ── inset shadow helpers ── */
  const shDark = "inset 0 1px 0 #252525, inset 0 -1px 0 #242424";
  const shRed = "inset 0 1px 0 #f24f51, inset 0 -1px 0 #ff7476";

  return (
    <div className="flex gap-5">
      {/* ════════ LEFT PANEL (401 × auto) ════════ */}
      <div className="w-[401px] shrink-0 rounded-[16px] flex flex-col" style={{ background: "linear-gradient(180deg,#161616,#0d0d0d)" }}>
        {/* ── Bet amount ── */}
        <div className="px-5 pt-5 pb-0">
          <p className="text-[14px] text-[#828282] mb-2">Bet amount</p>
          <div className="flex items-center h-[54px] bg-[#090909] rounded-[14px] px-[6px] gap-[6px]">
            <div className="flex-1 h-[42px] flex items-center px-3 rounded-[12px]" style={{ boxShadow: shDark, background: "#1a1a1a" }}>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={isActive}
                className="bg-transparent text-white text-[14px] font-medium outline-none appearance-none mr-2 cursor-pointer">
                {CURRENCIES.map((c) => <option key={c} value={c} className="bg-[#090909]">{c}</option>)}
              </select>
              <input value={isActive ? "$" + fmt(game?.betAtomic) : "$" + betInput}
                onChange={(e) => !isActive && setBetInput(e.target.value.replace(/^\$/, ""))}
                disabled={isActive}
                className="flex-1 bg-transparent text-white text-[16px] font-medium outline-none text-right min-w-0" />
            </div>
            <button onClick={() => setBetInput(String((parseFloat(betInput) / 2).toFixed(6)))} disabled={isActive}
              className="h-[42px] px-3 rounded-[12px] bg-white text-[#090909] text-[14px] font-medium disabled:opacity-30" style={{ boxShadow: shDark }}>
              1/2
            </button>
            <button disabled={isActive}
              className="h-[42px] px-3 rounded-[12px] bg-white text-[#090909] text-[14px] font-medium disabled:opacity-30" style={{ boxShadow: shDark }}>
              Max
            </button>
          </div>
        </div>

        {/* ── Divider SVG ── */}
        <div className="px-5 py-3">
          <img src={DIVIDER} alt="" className="w-full" />
        </div>

        {/* ── Number of mines ── */}
        <div className="px-5">
          <p className="text-[14px] text-[#828282] mb-2">Number of mines</p>
          <div className="flex items-center h-[54px] bg-[#090909] rounded-[14px] px-[6px]">
            <div className="h-[42px] px-4 rounded-[12px] flex items-center" style={{ boxShadow: shDark, background: "#1a1a1a" }}>
              <span className="text-white text-[16px] font-medium">{mineCount}</span>
            </div>
          </div>
        </div>

        {/* ── Preset buttons ── */}
        <div className="flex gap-[6px] px-5 mt-2">
          {MINE_PRESETS.map((n) => (
            <button key={n} onClick={() => setMineCount(n)} disabled={isActive}
              className={`flex-1 h-[42px] rounded-[12px] text-[14px] font-medium transition-all disabled:opacity-30 ${
                mineCount === n ? "text-white" : "text-[#828282]"
              }`}
              style={{
                background: mineCount === n ? "linear-gradient(180deg,#ac2e30,#f75154)" : "#1a1a1a",
                boxShadow: mineCount === n ? shRed : shDark,
              }}>
              {n}
            </button>
          ))}
        </div>

        {/* ── HR ── */}
        <hr className="border-[#1e1e1e] mx-5 my-3" />

        {/* ── Weapon art + multiplier ── */}
        <div className="flex-1 relative flex flex-col items-center justify-center overflow-hidden mx-5" style={{ background: "linear-gradient(180deg,#282828,#1a1a1a)", borderRadius: "12px" }}>
          <img src={RAIL_L} alt="" className="absolute left-2 top-1/2 -translate-y-1/2 h-[247px] opacity-50" />
          <img src={RAIL_R} alt="" className="absolute right-2 top-1/2 -translate-y-1/2 h-[247px] opacity-50" />
          <div className="relative z-10">
            <img src={POLY1} alt="" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150px] h-[172px] opacity-20" />
            <img src={POLY2} alt="" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[116px] h-[131px] opacity-15" />
            <img src={POLY3} alt="" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80px] h-[87px] opacity-10" />
            <img src={WEAPON} alt="" className="relative w-[250px] h-[200px] object-contain" style={{ transform: "rotate(12.9deg)" }} />
          </div>
          <div className="relative z-10 mt-2 mb-3 h-[42px] px-3 rounded-[12px] flex items-center justify-center" style={{ background: "linear-gradient(180deg,#ac2e30,#f75154)", boxShadow: shRed }}>
            <span className="text-white text-[16px] font-bold">x{fmtMul(game?.currentMultiplier)}</span>
          </div>
        </div>

        {/* ── Error ── */}
        {error && <p className="text-red-400 text-xs px-5 mt-2">{error}</p>}

        {/* ── Action buttons ── */}
        <div className="flex flex-col gap-2 p-5">
          {isActive ? (
            <>
              <button onClick={pickRandom} disabled={loading}
                className="w-full h-[52px] rounded-[12px] bg-[#1a1a1a] text-white text-[16px] font-medium disabled:opacity-50" style={{ boxShadow: shDark }}>
                Pick random tile
              </button>
              <button onClick={cashout} disabled={loading}
                className="w-full h-[52px] rounded-[12px] text-[#0d280f] text-[16px] font-bold disabled:opacity-50"
                style={{ background: "linear-gradient(180deg,#51ee5c,#37823c)", boxShadow: "0 2px 0 #0d2a0f, inset 0 1px 0 rgba(255,255,255,.15)" }}>
                Cashout {payoutStr}
              </button>
            </>
          ) : (
            <button onClick={start} disabled={loading || !betInput}
              className="w-full h-[52px] rounded-[12px] text-white text-[16px] font-bold disabled:opacity-50"
              style={{ background: "linear-gradient(180deg,#ac2e30,#f75154)", boxShadow: shRed }}>
              {loading ? "Starting..." : "Start game"}
            </button>
          )}
        </div>
      </div>

      {/* ════════ 5×5 GRID (flex-1) ════════ */}
      <div className="flex-1 rounded-[16px] flex items-start justify-center p-5" style={{ background: "linear-gradient(180deg,#161616,#0d0d0d)" }}>
        <div className="flex flex-wrap" style={{ width: "583px", gap: "11.88px" }}>
          {cells.map((st, i) => (
            <button key={i} onClick={() => reveal(i)} disabled={st !== "hidden" || !isActive || loading}
              className="flex flex-col items-center justify-center transition-all"
              style={{
                width: "106.9px", height: "106.9px", borderRadius: "12px",
                ...(st === "safe" ? { background: "linear-gradient(180deg,#51ee5c,#37823c)", boxShadow: "0 2px 0 #0d2a0f, inset 0 2px 2.5px rgba(0,0,0,.25), inset 0 -1px 0 #50e95a" } :
                  st === "mine" ? { background: "linear-gradient(180deg,#f75154,#ac2e30)", boxShadow: "0 2px 0 #2a0d0d, inset 0 2px 0 rgba(255,255,255,.07)" } : {}),
              }}>
              {st === "hidden" ? (
                <img src={HIDDEN_TILE} alt="" style={{ width: "106.9px", height: "108.9px" }}
                  className={isActive ? "cursor-pointer hover:brightness-110" : "opacity-50"} />
              ) : st === "safe" ? (
                <>
                  <img src={GEM_SVG} alt="" className="w-[54px] h-[48px]" />
                  <p className="text-[12px] font-bold text-[#0d280f] mt-0.5">{payoutStr}</p>
                </>
              ) : (
                <img src={BOMB} alt="" className="w-[50px] h-[50px] object-contain" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
