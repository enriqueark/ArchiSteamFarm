import { useState, useEffect } from "react";
import {
  startMinesGame, revealMine, cashoutMines, getWallets,
  type MinesGame, type MinesRevealResponse,
} from "@/lib/api";

const BOARD = 25;
const PRESETS = [1, 3, 5, 10, 24];
const A = "/assets/";
const TILE = `${A}09d0723a9bfccbed73637ba3ba799693.svg`;
const GEM = `${A}7314404ef65e3d5b3dc26009de5d710c.svg`;
const DIV = `${A}5edaa698796fe2f18fcc3c6a7ec12584.svg`;
const RL = `${A}53afd2537d26b04bd54b538a8d997e24.svg`;
const RR = `${A}b4fbfa3ebe2ac32ca7bc3136b2647ee7.svg`;
const P1 = `${A}b6d6c3347b8703c97896883a1403de0b.svg`;
const P2 = `${A}6b1afbc61c27e477151d378fd42686be.svg`;
const P3 = `${A}48299ac45bc8c79776e03a90ed321ed3.svg`;
const WPN = `${A}4e425b7d3c328e970651b77449845d15.png`;
const MINE = `${A}10f2877c99ecd50d20a64d37819aab29.png`;

type Cell = "hidden" | "safe" | "mine";
const f = (v: string | null | undefined, d = 6) => { if (!v) return "0.00"; const n = Number(v) / 10 ** d; return isNaN(n) ? "0.00" : n.toFixed(2); };
const fm = (v: string | null | undefined) => { if (!v) return "0.00"; const n = parseFloat(v); return isNaN(n) ? "0.00" : n.toFixed(2); };

const SD = "inset 0 1px 0 0 #252525, inset 0 -1px 0 0 #242424";
const SR = "inset 0 1px 0 0 #f24f51, inset 0 -1px 0 0 #ff7476";

export default function MinesPage() {
  const [bet, setBet] = useState("0.12");
  const [mc, setMc] = useState(1);
  const [game, setGame] = useState<MinesGame | null>(null);
  const [cells, setCells] = useState<Cell[]>(Array(BOARD).fill("hidden"));
  const [ld, setLd] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, setLR] = useState<MinesRevealResponse["reveal"] | null>(null);
  const [maxBal, setMaxBal] = useState(5000);

  useEffect(() => {
    getWallets().then((w) => {
      const wallet = w.find((x) => x.currency === "USDT");
      if (wallet) { const b = Number(wallet.balanceAtomic) / 1e6; setMaxBal(Math.min(b, 5000)); }
    }).catch(() => {});
  }, []);

  const act = game?.status === "ACTIVE";
  const lost = game?.status === "LOST";
  const ba = String(Math.round(parseFloat(bet || "0") * 1e6));

  const reset = () => { setCells(Array(BOARD).fill("hidden")); setLR(null); };
  const start = async () => {
    setErr(null); setLd(true); reset();
    try { const g = await startMinesGame("USDT", ba, mc); setGame(g);
      if (g.revealedCells?.length) { const n = Array(BOARD).fill("hidden") as Cell[]; g.revealedCells.forEach((i) => (n[i] = "safe")); setCells(n); }
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setLd(false); }
  };
  const reveal = async (idx: number) => {
    if (!game || cells[idx] !== "hidden" || !act) return;
    setErr(null); setLd(true);
    try { const r = await revealMine(game.gameId, idx); setGame(r); setLR(r.reveal);
      const n = [...cells]; n[idx] = r.reveal.hitMine ? "mine" : "safe";
      r.revealedCells?.forEach((i) => { if (n[i] === "hidden") n[i] = "safe"; }); setCells(n);
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setLd(false); }
  };
  const cashout = async () => {
    if (!game) return; setErr(null); setLd(true);
    try { setGame(await cashoutMines(game.gameId)); } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setLd(false); }
  };
  const pickR = () => { if (!act) return; const h = cells.map((s, i) => s === "hidden" ? i : -1).filter((i) => i >= 0); if (h.length) reveal(h[Math.floor(Math.random() * h.length)]); };

  const pay = "$" + f(game?.potentialPayoutAtomic);

  return (
    <div style={{ display: "flex", gap: "20px" }}>
      {/* ═══ LEFT PANEL 401px ═══ */}
      <div style={{ width: 401, maxWidth: 401, minHeight: 768, borderRadius: 16, overflow: "hidden", background: "linear-gradient(180deg,#161616,#0d0d0d)", display: "flex", flexDirection: "column" }}>
        <div style={{ width: 361, margin: "0 auto", padding: "20px 0", display: "flex", flexDirection: "column", gap: 20, flex: 1 }}>

          {/* Bet amount section */}
          <div style={{ display: "flex", flexDirection: "column", gap: 9, width: "100%" }}>
            <p style={{ color: "#828282", fontSize: 14, fontFamily: '"Gotham",sans-serif', fontWeight: 400, lineHeight: "14px", margin: 0 }}>Bet amount</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", minHeight: 54, borderRadius: 14, padding: 6, background: "#090909", boxSizing: "border-box" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 12px" }}>
                <p style={{ color: "#fff", fontSize: 16, fontFamily: '"Gotham",sans-serif', fontWeight: 500, margin: 0 }}>
                  ${act ? f(game?.betAtomic) : bet}
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "stretch", gap: 4 }}>
                <div onClick={() => !act && setBet(String(Math.max(0.1, parseFloat(bet || "0") / 2).toFixed(2)))}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 12px", borderRadius: 12, background: "#1a1a1a", boxShadow: SD, cursor: act ? "default" : "pointer", height: 42, opacity: act ? 0.3 : 1 }}>
                  <p style={{ color: "#828282", fontSize: 16, fontFamily: '"Gotham",sans-serif', fontWeight: 500, margin: 0 }}>1/2</p>
                </div>
                <div onClick={() => { if (!act) setBet(String(maxBal.toFixed(2))); }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 12px", borderRadius: 12, background: "#1a1a1a", boxShadow: SD, cursor: act ? "default" : "pointer", height: 42, opacity: act ? 0.3 : 1 }}>
                  <p style={{ color: "#828282", fontSize: 16, fontFamily: '"Gotham",sans-serif', fontWeight: 500, margin: 0 }}>Max</p>
                </div>
              </div>
            </div>
          </div>

          {/* Divider SVG */}
          <img src={DIV} alt="" style={{ width: "100%", display: "block" }} />

          {/* Number of mines section */}
          <div style={{ display: "flex", flexDirection: "column", gap: 9, width: "100%" }}>
            <p style={{ color: "#828282", fontSize: 14, fontFamily: '"Gotham",sans-serif', fontWeight: 400, lineHeight: "14px", margin: 0 }}>Number of mines</p>
            <div style={{ display: "flex", alignItems: "center", width: "100%", minHeight: 54, borderRadius: 14, padding: 6, background: "#090909", boxSizing: "border-box" }}>
              <input type="number" min={1} max={24} value={mc} disabled={act}
                onChange={(e) => setMc(Math.min(24, Math.max(1, parseInt(e.target.value) || 1)))}
                style={{ width: 60, height: 42, borderRadius: 12, border: "none", outline: "none", background: "transparent", color: "#fff", fontSize: 16, fontFamily: '"Gotham",sans-serif', fontWeight: 500, textAlign: "center", padding: "0 12px" }} />
            </div>
          </div>

          {/* Preset buttons */}
          <div style={{ display: "flex", gap: 4, width: "100%", justifyContent: "center" }}>
            {PRESETS.map((n) => (
              <div key={n} onClick={() => !act && setMc(n)}
                style={{ flexGrow: 1, flexShrink: 1, maxWidth: 69, minHeight: 42, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 12px", borderRadius: 12,
                  background: mc === n ? "linear-gradient(180deg,#ac2e30,#f75154)" : "#1a1a1a",
                  boxShadow: mc === n ? SR : SD, cursor: act ? "default" : "pointer", opacity: act ? 0.3 : 1 }}>
                <p style={{ color: mc === n ? "#fff" : "#828282", fontSize: 16, fontFamily: '"Gotham",sans-serif', fontWeight: 500, margin: 0 }}>{n}</p>
              </div>
            ))}
          </div>

          {/* HR */}
          <hr style={{ width: "100%", border: "none", borderTop: "1px solid #1e1e1e", margin: 0 }} />

          {/* Weapon art + multiplier */}
          <div style={{ flex: 1, width: "100%", overflow: "hidden", borderRadius: 12, background: "linear-gradient(180deg,#282828,#1a1a1a)", position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <img src={RL} alt="" style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", height: 247, opacity: 0.5 }} />
            <img src={RR} alt="" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", height: 247, opacity: 0.5 }} />
            <div style={{ position: "relative", width: 266, minHeight: 200 }}>
              <img src={P1} alt="" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 151, height: 172, opacity: 0.2 }} />
              <img src={P2} alt="" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 116, height: 131, opacity: 0.15 }} />
              <img src={P3} alt="" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 80, height: 87, opacity: 0.1 }} />
              <img src={WPN} alt="" style={{ width: 266, height: 199, objectFit: "contain", display: "block", position: "relative", zIndex: 1, filter: lost ? "brightness(0.4)" : "none" }} />
            </div>
            <div style={{ width: 69, maxWidth: 69, minHeight: 42, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 12px", borderRadius: 12, background: "linear-gradient(180deg,#ac2e30,#f75154)", boxShadow: SR, marginTop: 8, marginBottom: 8, position: "relative", zIndex: 1 }}>
              <p style={{ color: "#fff", fontSize: 16, fontFamily: '"Gotham",sans-serif', fontWeight: 500, margin: 0 }}>x{fm(game?.currentMultiplier)}</p>
            </div>
          </div>

          {/* Error */}
          {err && <p style={{ color: "#f34950", fontSize: 12, margin: 0 }}>{err}</p>}

          {/* Action buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
            {act ? (
              <>
                <div onClick={pickR} style={{ width: "100%", padding: "16px 36px", borderRadius: 12, background: "#1a1a1a", boxShadow: SD, display: "flex", alignItems: "center", justifyContent: "center", cursor: ld ? "default" : "pointer", opacity: ld ? 0.5 : 1 }}>
                  <p style={{ color: "#828282", fontSize: 18, fontFamily: '"Gotham",sans-serif', fontWeight: 500, margin: 0, textAlign: "center" }}>Pick random tile</p>
                </div>
                <div onClick={cashout} style={{ width: "100%", padding: "16px 36px", borderRadius: 12, background: "linear-gradient(180deg,#ac2e30,#f75154)", boxShadow: SR, display: "flex", alignItems: "center", justifyContent: "center", cursor: ld ? "default" : "pointer", opacity: ld ? 0.5 : 1 }}>
                  <p style={{ color: "#fff", fontSize: 18, fontFamily: '"Gotham",sans-serif', fontWeight: 500, margin: 0, textAlign: "center" }}>Cashout {pay}</p>
                </div>
              </>
            ) : (
              <div onClick={() => !ld && parseFloat(bet) > 0 && start()} style={{ width: "100%", padding: "16px 36px", borderRadius: 12, background: "linear-gradient(180deg,#ac2e30,#f75154)", boxShadow: SR, display: "flex", alignItems: "center", justifyContent: "center", cursor: ld ? "default" : "pointer", opacity: ld || parseFloat(bet) <= 0 ? 0.5 : 1 }}>
                <p style={{ color: "#fff", fontSize: 18, fontFamily: '"Gotham",sans-serif', fontWeight: 500, margin: 0, textAlign: "center" }}>{ld ? "Starting..." : "Start game"}</p>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ═══ 5×5 GRID 824px ═══ */}
      <div style={{ width: 824, maxWidth: 824, minHeight: 768, borderRadius: 16, overflow: "hidden", background: "linear-gradient(180deg,#161616,#0d0d0d)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 583, maxWidth: 583, display: "flex", flexWrap: "wrap", gap: 11.88, justifyContent: "flex-start", alignItems: "center" }}>
          {cells.map((st, i) => {
            if (st === "hidden") return (
              <img key={i} src={TILE} alt="" onClick={() => reveal(i)}
                style={{ width: 107, maxWidth: 107, minHeight: 107, borderRadius: 12, display: "block", margin: 0, boxShadow: "0 2px 0 0 #161616, inset 0 2px 0 0 rgba(255,255,255,.07)", cursor: act ? "pointer" : "default", opacity: act ? 1 : 0.5 }} />
            );
            if (st === "safe") return (
              <div key={i} style={{ width: 107, maxWidth: 107, minHeight: 107, borderRadius: 12, overflow: "hidden", background: "linear-gradient(180deg,#51ee5c,#37823c)", boxShadow: "0 2px 0 0 #0d2a0f, inset 0 2px 0 0 rgba(255,255,255,.07)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <img src={GEM} alt="" style={{ width: 54, height: "auto", display: "block" }} />
                <p style={{ color: "#0d280f", fontSize: 16, fontFamily: '"Gotham",sans-serif', fontWeight: 500, margin: 0, textAlign: "center", lineHeight: "20px" }}>{pay}</p>
              </div>
            );
            return (
              <div key={i} style={{ width: 107, maxWidth: 107, minHeight: 107, borderRadius: 12, overflow: "hidden", background: "linear-gradient(180deg,#f75154,#ac2e30)", boxShadow: "0 2px 0 0 #2a0d0d, inset 0 2px 0 0 rgba(255,255,255,.07)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <img src={MINE} alt="mine" style={{ width: 70, height: 70, objectFit: "contain" }} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
