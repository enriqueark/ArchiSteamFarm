import { useState, useEffect, useCallback } from "react";
import { startMinesGame, revealMine, cashoutMines, getWallets, getSkinPreviewByAmountAtomic, type MinesGame, type MinesRevealResponse } from "@/lib/api";

const BOARD = 25;
const PRESETS = [1, 3, 5, 10, 24];
const A = "/assets/";
const TILE = `${A}09d0723a9bfccbed73637ba3ba799693.svg`;
const GEM = `${A}7314404ef65e3d5b3dc26009de5d710c.svg`;
const MINE_TILE = `${A}903011fe39cdcfe98c260e419ff22c1c.svg`;
const DIV = `${A}5edaa698796fe2f18fcc3c6a7ec12584.svg`;
const RL = `${A}53afd2537d26b04bd54b538a8d997e24.svg`;
const RR = `${A}b4fbfa3ebe2ac32ca7bc3136b2647ee7.svg`;
const P1 = `${A}b6d6c3347b8703c97896883a1403de0b.svg`;
const P2 = `${A}6b1afbc61c27e477151d378fd42686be.svg`;
const P3 = `${A}48299ac45bc8c79776e03a90ed321ed3.svg`;

type Cell = "hidden" | "safe" | "mine";
const G = '"DM Sans","Gotham",sans-serif';
const f = (v: string | null | undefined, d = 6) => { if (!v) return "0.00"; const n = Number(v) / 10 ** d; return isNaN(n) ? "0.00" : n.toFixed(2); };
const fm = (v: string | null | undefined) => { if (!v) return "0.00"; const n = parseFloat(v); return isNaN(n) ? "0.00" : n.toFixed(2); };
const SD = "inset 0 1px 0 0 #252525, inset 0 -1px 0 0 #242424";
const SR = "inset 0 1px 0 0 #f24f51, inset 0 -1px 0 0 #ff7476";

export default function MinesPage() {
  const [bet, setBet] = useState("0");
  const [mc, setMc] = useState(1);
  const [game, setGame] = useState<MinesGame | null>(null);
  const [cells, setCells] = useState<Cell[]>(Array(BOARD).fill("hidden"));
  const [ld, setLd] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, setLR] = useState<MinesRevealResponse["reveal"] | null>(null);
  const [maxBal, setMaxBal] = useState(5000);
  const [skinUrl, setSkinUrl] = useState<string | null>(null);

  useEffect(() => {
    getWallets().then((w) => {
      const wallet = w.find((x) => x.currency === "USDT");
      if (wallet) setMaxBal(Math.min(Number(wallet.balanceAtomic) / 1e6, 5000));
    }).catch(() => {});
  }, []);

  const act = game?.status === "ACTIVE";
  const lost = game?.status === "LOST";
  const betNum = parseFloat(bet || "0");
  const ba = String(Math.round(betNum * 1e6));

  const fetchSkin = useCallback(async (amountAtomic: string | null | undefined) => {
    if (!amountAtomic || amountAtomic === "0") { setSkinUrl(null); return; }
    try {
      const res = await getSkinPreviewByAmountAtomic(amountAtomic);
      setSkinUrl(res.preview?.imageUrl || null);
    } catch { setSkinUrl(null); }
  }, []);

  const reset = () => { setCells(Array(BOARD).fill("hidden")); setLR(null); setSkinUrl(null); };
  const start = async () => {
    setErr(null); setLd(true); reset();
    try {
      const g = await startMinesGame("USDT", ba, mc); setGame(g);
      if (g.revealedCells?.length) { const n = Array(BOARD).fill("hidden") as Cell[]; g.revealedCells.forEach((i) => (n[i] = "safe")); setCells(n); }
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setLd(false); }
  };
  const reveal = async (idx: number) => {
    if (!game || cells[idx] !== "hidden" || !act) return;
    setErr(null); setLd(true);
    try {
      const r = await revealMine(game.gameId, idx); setGame(r); setLR(r.reveal);
      const n = [...cells]; n[idx] = r.reveal.hitMine ? "mine" : "safe";
      r.revealedCells?.forEach((i) => { if (n[i] === "hidden") n[i] = "safe"; }); setCells(n);
      if (!r.reveal.hitMine && r.status === "ACTIVE") {
        fetchSkin(r.potentialPayoutAtomic);
      } else {
        setSkinUrl(null);
      }
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setLd(false); }
  };
  const cashout = async () => {
    if (!game) return; setErr(null); setLd(true);
    try { setGame(await cashoutMines(game.gameId)); setSkinUrl(null); } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setLd(false); }
  };
  const pickR = () => {
    if (!act) return;
    const h = cells.map((s, i) => s === "hidden" ? i : -1).filter((i) => i >= 0);
    if (h.length) reveal(h[Math.floor(Math.random() * h.length)]);
  };

  const pay = "$" + f(game?.potentialPayoutAtomic);

  return (
    <div style={{ display: "flex", gap: 16, height: "100%" }}>

      {/* ═══ LEFT PANEL — 30% width ═══ */}
      <div style={{
        width: "30%", maxWidth: 401, minWidth: 280,
        borderRadius: 16, overflow: "hidden",
        background: "linear-gradient(180deg,#161616,#0d0d0d)",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{
          padding: "16px 20px",
          display: "flex", flexDirection: "column", gap: 10,
          flex: 1,
        }}>

          {/* Bet amount */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ color: "#828282", fontSize: 14, fontFamily: G, fontWeight: 400, margin: 0 }}>Bet amount</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 48, borderRadius: 14, padding: 6, background: "#090909", boxSizing: "border-box" }}>
              <div style={{ display: "flex", alignItems: "center", padding: "0 12px", flex: 1 }}>
                <span style={{ color: "#fff", fontSize: 16, fontFamily: G, fontWeight: 500 }}>$</span>
                <input value={act ? f(game?.betAtomic) : bet}
                  onChange={(e) => { if (!act) setBet(e.target.value); }}
                  disabled={act}
                  style={{ background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 16, fontFamily: G, fontWeight: 500, width: "100%", padding: 0, marginLeft: 2 }} />
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <div onClick={() => !act && setBet(String(Math.max(0, betNum / 2).toFixed(2)))}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 12px", borderRadius: 12, background: "#1a1a1a", boxShadow: SD, cursor: "pointer", height: 38, opacity: act ? 0.3 : 1 }}>
                  <p style={{ color: "#fff", fontSize: 14, fontFamily: G, fontWeight: 500, margin: 0 }}>1/2</p>
                </div>
                <div onClick={() => !act && setBet(maxBal.toFixed(2))}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 12px", borderRadius: 12, background: "#1a1a1a", boxShadow: SD, cursor: "pointer", height: 38, opacity: act ? 0.3 : 1 }}>
                  <p style={{ color: "#fff", fontSize: 14, fontFamily: G, fontWeight: 500, margin: 0 }}>Max</p>
                </div>
              </div>
            </div>
          </div>

          {/* Red bar slider */}
          <div style={{ cursor: act ? "default" : "pointer" }}
            onClick={(e) => {
              if (act) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              setBet((pct * maxBal).toFixed(2));
            }}>
            <img src={DIV} alt="" style={{ width: "100%", display: "block" }} />
          </div>

          {/* Number of mines */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ color: "#828282", fontSize: 14, fontFamily: G, fontWeight: 400, margin: 0 }}>Number of mines</p>
            <div style={{ display: "flex", alignItems: "center", minHeight: 48, borderRadius: 14, padding: 6, background: "#090909", boxSizing: "border-box" }}>
              <input type="number" min={1} max={24} value={mc} disabled={act}
                onChange={(e) => setMc(Math.min(24, Math.max(1, parseInt(e.target.value) || 1)))}
                style={{ width: "100%", height: 38, borderRadius: 12, border: "none", outline: "none", background: "transparent", color: "#fff", fontSize: 16, fontFamily: G, fontWeight: 500, padding: "0 12px", boxSizing: "border-box" }} />
            </div>
          </div>

          {/* Presets */}
          <div style={{ display: "flex", gap: 4 }}>
            {PRESETS.map((n) => (
              <div key={n} onClick={() => !act && setMc(n)}
                style={{ flex: 1, minHeight: 38, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12,
                  background: mc === n ? "linear-gradient(180deg,#ac2e30,#f75154)" : "#1a1a1a",
                  boxShadow: mc === n ? SR : SD, cursor: "pointer", opacity: act ? 0.3 : 1 }}>
                <p style={{ color: "#fff", fontSize: 14, fontFamily: G, fontWeight: 500, margin: 0 }}>{n}</p>
              </div>
            ))}
          </div>

          {/* HR */}
          <hr style={{ width: "100%", border: "none", borderTop: "1px solid #1e1e1e", margin: 0 }} />

          {/* Weapon art + multiplier — takes remaining space */}
          <div style={{
            flex: 1,
            overflow: "hidden", borderRadius: 12,
            background: "#090909",
            position: "relative",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
          }}>
            <img src={RL} alt="" style={{ position: "absolute", left: 4, top: "50%", transform: "translateY(-50%)", height: "80%", opacity: 0.5 }} />
            <img src={RR} alt="" style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", height: "80%", opacity: 0.5 }} />
            <div style={{ position: "relative", width: "80%", aspectRatio: "266/200", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <img src={P1} alt="" style={{ position: "absolute", width: "57%", height: "auto", opacity: 0.2 }} />
              <img src={P2} alt="" style={{ position: "absolute", width: "44%", height: "auto", opacity: 0.15 }} />
              <img src={P3} alt="" style={{ position: "absolute", width: "30%", height: "auto", opacity: 0.1 }} />
              {skinUrl && (
                <img src={skinUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", position: "relative", zIndex: 1, filter: lost ? "brightness(0.4)" : "none" }} />
              )}
            </div>
            <div style={{ minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 14px", borderRadius: 12, background: "linear-gradient(180deg,#ac2e30,#f75154)", boxShadow: SR, marginTop: 6, position: "relative", zIndex: 1 }}>
              <p style={{ color: "#fff", fontSize: 14, fontFamily: G, fontWeight: 500, margin: 0, whiteSpace: "nowrap" }}>x{fm(game?.currentMultiplier)}</p>
            </div>
          </div>

          {err && <p style={{ color: "#f34950", fontSize: 12, margin: 0 }}>{err}</p>}

          {/* Buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {act ? (
              <>
                <div onClick={pickR} style={{ padding: "14px 24px", borderRadius: 12, background: "#1a1a1a", boxShadow: SD, display: "flex", justifyContent: "center", cursor: "pointer", opacity: ld ? 0.5 : 1 }}>
                  <p style={{ color: "#828282", fontSize: 16, fontFamily: G, fontWeight: 500, margin: 0 }}>Pick random tile</p>
                </div>
                <div onClick={cashout} style={{ padding: "14px 24px", borderRadius: 12, background: "linear-gradient(180deg,#ac2e30,#f75154)", boxShadow: SR, display: "flex", justifyContent: "center", cursor: "pointer", opacity: ld ? 0.5 : 1 }}>
                  <p style={{ color: "#fff", fontSize: 16, fontFamily: G, fontWeight: 500, margin: 0 }}>Cashout {pay}</p>
                </div>
              </>
            ) : (
              <div onClick={() => !ld && betNum > 0 && start()} style={{ padding: "14px 24px", borderRadius: 12, background: "linear-gradient(180deg,#ac2e30,#f75154)", boxShadow: SR, display: "flex", justifyContent: "center", cursor: "pointer", opacity: ld || betNum <= 0 ? 0.5 : 1 }}>
                <p style={{ color: "#fff", fontSize: 16, fontFamily: G, fontWeight: 500, margin: 0 }}>{ld ? "Starting..." : "Start game"}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ 5×5 GRID — 70% width ═══ */}
      <div style={{
        flex: 1,
        borderRadius: 16, overflow: "hidden",
        background: "linear-gradient(180deg,#161616,#0d0d0d)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, width: "100%", maxWidth: 600 }}>
          {cells.map((st, i) => {
            if (st === "mine") return (
              <img key={i} src={MINE_TILE} alt="mine" style={{ width: "100%", aspectRatio: "107/109", borderRadius: 12, display: "block" }} />
            );
            if (st === "safe") return (
              <div key={i} style={{ width: "100%", aspectRatio: "1", borderRadius: 12, overflow: "hidden", background: "linear-gradient(180deg,#4ade60,#2d8f35)", boxShadow: "0 3px 0 0 #0d2a0f, inset 0 2px 0 rgba(255,255,255,.12)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <img src={GEM} alt="" style={{ width: "55%", height: "auto" }} />
                <p style={{ color: "#0a2e0c", fontSize: 16, fontFamily: G, fontWeight: 700, margin: 0 }}>{pay}</p>
              </div>
            );
            return (
              <img key={i} src={TILE} alt="" onClick={() => reveal(i)}
                style={{ width: "100%", aspectRatio: "107/109", borderRadius: 12, display: "block", boxShadow: "0 2px 0 0 #161616, inset 0 2px 0 0 rgba(255,255,255,.07)", cursor: act ? "pointer" : "default", opacity: act ? 1 : 0.5 }} />
            );
          })}
        </div>
      </div>
    </div>
  );
}
