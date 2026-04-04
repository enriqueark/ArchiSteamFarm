import { useState, useEffect } from "react";
import { startMinesGame, revealMine, cashoutMines, getWallets, type MinesGame, type MinesRevealResponse } from "@/lib/api";

const BOARD = 25;
const PRESETS = [1, 3, 5, 10, 24];
const A = "/assets/";

type Cell = "hidden" | "safe" | "mine";
const fmt = (v: string | null | undefined, d = 6) => {
  if (!v) return "0.00"; const n = Number(v) / 10 ** d; return isNaN(n) ? "0.00" : n.toFixed(2);
};
const fmtM = (v: string | null | undefined) => {
  if (!v) return "0.00"; const n = parseFloat(v); return isNaN(n) ? "0.00" : n.toFixed(2);
};

export default function MinesPage() {
  const [bet, setBet] = useState("0.12");
  const [mc, setMc] = useState(1);
  const [game, setGame] = useState<MinesGame | null>(null);
  const [cells, setCells] = useState<Cell[]>(Array(BOARD).fill("hidden"));
  const [ld, setLd] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [maxBal, setMaxBal] = useState(5000);

  useEffect(() => {
    getWallets().then((w) => {
      const wallet = w.find((x) => x.currency === "USDT");
      if (wallet) setMaxBal(Math.min(Number(wallet.balanceAtomic) / 1e6, 5000));
    }).catch(() => {});
  }, []);

  const act = game?.status === "ACTIVE";
  const lost = game?.status === "LOST";
  const ba = String(Math.round(parseFloat(bet || "0") * 1e6));
  const pay = "$" + fmt(game?.potentialPayoutAtomic);

  const start = async () => {
    setErr(null); setLd(true); setCells(Array(BOARD).fill("hidden"));
    try {
      const g = await startMinesGame("USDT", ba, mc); setGame(g);
      if (g.revealedCells?.length) { const n = Array(BOARD).fill("hidden") as Cell[]; g.revealedCells.forEach((i) => (n[i] = "safe")); setCells(n); }
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setLd(false); }
  };
  const reveal = async (idx: number) => {
    if (!game || cells[idx] !== "hidden" || !act) return;
    setErr(null); setLd(true);
    try {
      const r = await revealMine(game.gameId, idx); setGame(r);
      const n = [...cells]; n[idx] = r.reveal.hitMine ? "mine" : "safe";
      r.revealedCells?.forEach((i) => { if (n[i] === "hidden") n[i] = "safe"; }); setCells(n);
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setLd(false); }
  };
  const cashout = async () => {
    if (!game) return; setErr(null); setLd(true);
    try { setGame(await cashoutMines(game.gameId)); } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setLd(false); }
  };
  const pickR = () => {
    if (!act) return; const h = cells.map((s, i) => s === "hidden" ? i : -1).filter((i) => i >= 0);
    if (h.length) reveal(h[Math.floor(Math.random() * h.length)]);
  };

  return (
    <div style={{ display: "flex", gap: 20 }}>
      {/* ═══ LEFT PANEL ═══ */}
      <div className="mines-kx-frame-n5">
        <div className="mines-kx-frame-ld">
          {/* Bet amount */}
          <div className="mines-kx-frame-ac">
            <div className="mines-kx-text-bet-amount-y61">
              <p className="mines-kx-text-bet-amount-y62">Bet amount</p>
            </div>
            <div className="mines-kx-frame13">
              <div className="mines-kx-frame-at">
                <div className="mines-kx-text12f11">
                  <input className="mines-kx-text12f12" value={act ? "$" + fmt(game?.betAtomic) : "$" + bet}
                    onChange={(e) => !act && setBet(e.target.value.replace(/^\$/, ""))} disabled={act}
                    style={{ background: "transparent", border: "none", outline: "none", width: "100%", padding: 0, font: "inherit", color: "inherit" }} />
                </div>
              </div>
              <div className="mines-kx-frame27">
                <div className="mines-kx-frame-u3" onClick={() => !act && setBet(String(Math.max(0.1, parseFloat(bet || "0") / 2).toFixed(2)))} style={{ cursor: "pointer" }}>
                  <div className="mines-kx-text12-zx1"><p className="mines-kx-text12-zx2">1/2</p></div>
                </div>
                <div className="mines-kx-frame-j2" onClick={() => !act && setBet(maxBal.toFixed(2))} style={{ cursor: "pointer" }}>
                  <div className="mines-kx-text-max811"><p className="mines-kx-text-max812">Max</p></div>
                </div>
              </div>
            </div>
          </div>

          {/* Divider SVG */}
          <img src={`${A}5edaa698796fe2f18fcc3c6a7ec12584.svg`} alt="" width="361" height="16" className="mines-kx-vector-frame97-oa" />

          {/* Number of mines */}
          <div className="mines-kx-frame-we">
            <div className="mines-kx-text-number-mines7f1">
              <p className="mines-kx-text-number-mines7f2">Number of mines</p>
            </div>
            <div className="mines-kx-frame-ig2">
              <div className="mines-kx-frame7w">
                <div className="mines-kx-text1-wv1">
                  <input className="mines-kx-text1-wv2" type="number" min={1} max={24} value={mc}
                    onChange={(e) => !act && setMc(Math.min(24, Math.max(1, parseInt(e.target.value) || 1)))} disabled={act}
                    style={{ background: "transparent", border: "none", outline: "none", width: 40, padding: 0, font: "inherit", color: "inherit", textAlign: "left" }} />
                </div>
              </div>
            </div>
          </div>

          {/* Preset buttons */}
          <div className="mines-kx-frame6q">
            {PRESETS.map((n) => (
              <div key={n} className={mc === n ? "mines-kx-frame2p" : "mines-kx-frame-ss"} onClick={() => !act && setMc(n)} style={{ cursor: "pointer" }}>
                <div className={mc === n ? "mines-kx-text1-hr1" : "mines-kx-text3-vp1"}>
                  <p className={mc === n ? "mines-kx-text1-hr2" : "mines-kx-text3-vp2"}>{n}</p>
                </div>
              </div>
            ))}
          </div>

          {/* HR */}
          <hr className="mines-kx-frame-line1-qs" />

          {/* Weapon art + multiplier */}
          <div className="mines-kx-frame-tp">
            <img src={`${A}53afd2537d26b04bd54b538a8d997e24.svg`} alt="" width="18.2" height="247.4" className="mines-kx-vector-group4-ak" />
            <img src={`${A}b4fbfa3ebe2ac32ca7bc3136b2647ee7.svg`} alt="" width="18.2" height="247.4" className="mines-kx-vector-group5-ll" />
            <div className="mines-kx-frame-group63m">
              <img src={`${A}b6d6c3347b8703c97896883a1403de0b.svg`} alt="" width="150.78" height="171.86" className="mines-kx-vector-polygon1x9" />
              <img src={`${A}6b1afbc61c27e477151d378fd42686be.svg`} alt="" width="116.07" height="130.58" className="mines-kx-vector-polygon28a" />
              <img src={`${A}48299ac45bc8c79776e03a90ed321ed3.svg`} alt="" width="79.8" height="87.05" className="mines-kx-vector-polygon3-po" />
              <img src={`${A}4e425b7d3c328e970651b77449845d15.png`} alt="" width="334.19" height="267.69" className="mines-kx-image2405e76b4b1-en"
                style={lost ? { filter: "brightness(0.4)" } : undefined} />
            </div>
            <div className="mines-kx-frame-xs">
              <div className="mines-kx-text92-mr1">
                <p className="mines-kx-text92-mr2">x{fmtM(game?.currentMultiplier)}</p>
              </div>
            </div>
          </div>

          {/* Error */}
          {err && <p style={{ color: "#f34950", fontSize: 12, margin: 0 }}>{err}</p>}

          {/* Action buttons */}
          <div className="mines-kx-frame-wd">
            {act ? (
              <>
                <div className="mines-kx-frame-bq3" onClick={pickR} style={{ cursor: "pointer", opacity: ld ? 0.5 : 1 }}>
                  <div className="mines-kx-text-pick-random0p1"><p className="mines-kx-text-pick-random0p2">Pick random tile</p></div>
                </div>
                <div className="mines-kx-frame7e" onClick={cashout} style={{ cursor: "pointer", opacity: ld ? 0.5 : 1 }}>
                  <div className="mines-kx-text11-qj1"><p className="mines-kx-text11-qj2">Cashout {pay}</p></div>
                </div>
              </>
            ) : (
              <div className="mines-kx-frame7e" onClick={() => !ld && parseFloat(bet) > 0 && start()} style={{ cursor: "pointer", opacity: ld || parseFloat(bet) <= 0 ? 0.5 : 1 }}>
                <div className="mines-kx-text11-qj1"><p className="mines-kx-text11-qj2">{ld ? "Starting..." : "Start game"}</p></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ 5×5 GRID ═══ */}
      <div className="mines-kx-frame4h">
        <div className="mines-kx-frame9o">
          {cells.map((st, i) => {
            if (st === "safe") return (
              <div key={i} className="mines-kx-frame53">
                <img src={`${A}7314404ef65e3d5b3dc26009de5d710c.svg`} alt="" width="54.17" height="47.94" className="mines-kx-vector-bw" />
                <div className="mines-kx-text920v1"><p className="mines-kx-text920v2">{pay}</p></div>
              </div>
            );
            if (st === "mine") return (
              <div key={i} className="mines-kx-frame53" style={{ background: "linear-gradient(180deg,#f75154,#ac2e30)", boxShadow: "0 2px 0 0 #2a0d0d, inset 0 2px 0 0 rgba(255,255,255,.07)" }}>
                <img src={`${A}10f2877c99ecd50d20a64d37819aab29.png`} alt="mine" style={{ width: 60, height: 60, objectFit: "contain", margin: "auto" }} />
              </div>
            );
            return (
              <img key={i} src={`${A}09d0723a9bfccbed73637ba3ba799693.svg`} alt="" width="106.9" height="108.9"
                className="mines-kx-vector-frame108-fi" onClick={() => reveal(i)}
                style={{ cursor: act ? "pointer" : "default", opacity: act ? 1 : 0.5 }} />
            );
          })}
        </div>
      </div>
    </div>
  );
}
