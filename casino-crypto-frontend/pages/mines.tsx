import { useState, useEffect, useCallback, useRef } from "react";
import { startMinesGame, revealMine, cashoutMines, getWallets, getSkinPreviewByAmountAtomic, getActiveMinesGame, type MinesGame, type MinesRevealResponse } from "@/lib/api";
import { refreshBalance } from "@/lib/refreshBalance";
import { requestLiveWinsRefresh } from "@/lib/liveWinsTicker";
import { getGameVolume } from "@/lib/gameAudio";
import CoinAmount from "@/components/CoinAmount";
import CoinIcon from "@/components/CoinIcon";

const BOARD = 25;
const PRESETS = [1, 3, 5, 10, 24];
const A = "/assets/";
const TILE = `${A}09d0723a9bfccbed73637ba3ba799693.svg`;
const GEM = `${A}7314404ef65e3d5b3dc26009de5d710c.svg`;
const MINE_TILE = `${A}903011fe39cdcfe98c260e419ff22c1c.svg`;
const RL = `${A}53afd2537d26b04bd54b538a8d997e24.svg`;
const RR = `${A}b4fbfa3ebe2ac32ca7bc3136b2647ee7.svg`;
const P1 = `${A}b6d6c3347b8703c97896883a1403de0b.svg`;
const P2 = `${A}6b1afbc61c27e477151d378fd42686be.svg`;
const P3 = `${A}48299ac45bc8c79776e03a90ed321ed3.svg`;

type Cell = "hidden" | "safe" | "mine";
const G = '"DM Sans","Gotham",sans-serif';
const COIN_DECIMALS = 1e8;
const f = (v: string | null | undefined, d = 8) => { if (!v) return "0.00"; const n = Number(v) / 10 ** d; return isNaN(n) ? "0.00" : n.toFixed(2); };
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
  const [draggingBet, setDraggingBet] = useState(false);
  const [skinAnimTick, setSkinAnimTick] = useState(0);
  const [cellAnim, setCellAnim] = useState<Record<number, "safe" | "mine">>({});
  const [safeCellGainByIndex, setSafeCellGainByIndex] = useState<Record<number, string>>({});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const cellAnimTimeoutsRef = useRef<number[]>([]);

  useEffect(() => {
    getWallets().then((w) => {
      const wallet = w.find((x) => x.currency === "USDT");
      if (wallet) setMaxBal(Math.min(Number(wallet.balanceAtomic) / COIN_DECIMALS, 5000));
    }).catch(() => {});
  }, []);

  const act = game?.status === "ACTIVE";
  const lost = game?.status === "LOST";
  const cashedOut = game?.status === "CASHED_OUT";
  const parsedBet = Number.parseFloat(bet || "0");
  const betNum = Number.isFinite(parsedBet) ? parsedBet : 0;
  const ba = String(Math.round(betNum * COIN_DECIMALS));
  const betPct = maxBal > 0 ? Math.max(0, Math.min(1, betNum / maxBal)) : 0;

  const setBetFromClientX = useCallback((clientX: number, sliderEl: HTMLDivElement) => {
    if (act || maxBal <= 0) return;
    const rect = sliderEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setBet((pct * maxBal).toFixed(2));
  }, [act, maxBal]);

  const getAudioContext = useCallback(() => {
    if (typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new Ctor();
    }
    if (audioCtxRef.current.state === "suspended") {
      void audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const playGemSfx = useCallback(() => {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const volume = getGameVolume();
    if (volume <= 0) return;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.028 * volume, now + 0.03);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    out.connect(ctx.destination);

    const notes = [720, 980];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + idx * 0.07;
      const end = start + 0.16;
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.8, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(out);
      osc.start(start);
      osc.stop(end);
    });
  }, [getAudioContext]);

  const playMineSfx = useCallback(() => {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const volume = getGameVolume();
    if (volume <= 0) return;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.034 * volume, now + 0.03);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
    out.connect(ctx.destination);

    const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.23), ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const falloff = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * falloff;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.setValueAtTime(1250, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(320, now + 0.24);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.9, now + 0.02);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(out);
    noise.start(now);
    noise.stop(now + 0.26);

    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = "sine";
    boom.frequency.setValueAtTime(120, now);
    boom.frequency.exponentialRampToValueAtTime(52, now + 0.28);
    boomGain.gain.setValueAtTime(0.0001, now);
    boomGain.gain.exponentialRampToValueAtTime(0.75, now + 0.03);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    boom.connect(boomGain);
    boomGain.connect(out);
    boom.start(now);
    boom.stop(now + 0.35);
  }, [getAudioContext]);

  const triggerCellAnimation = useCallback((safeIndices: number[], mineIndex: number | null) => {
    const nextKeys = [...safeIndices];
    if (mineIndex !== null) nextKeys.push(mineIndex);
    if (!nextKeys.length) return;
    setCellAnim((prev) => {
      const copy = { ...prev };
      safeIndices.forEach((i) => { copy[i] = "safe"; });
      if (mineIndex !== null) copy[mineIndex] = "mine";
      return copy;
    });
    const timeout = window.setTimeout(() => {
      setCellAnim((prev) => {
        const copy = { ...prev };
        nextKeys.forEach((i) => { delete copy[i]; });
        return copy;
      });
    }, mineIndex !== null ? 820 : 620);
    cellAnimTimeoutsRef.current.push(timeout);
  }, []);

  const fetchSkin = useCallback(async (amountAtomic: string | null | undefined) => {
    if (!amountAtomic || amountAtomic === "0") { setSkinUrl(null); return; }
    try {
      const res = await getSkinPreviewByAmountAtomic(amountAtomic);
      setSkinUrl(res.preview?.imageUrl || null);
    } catch { setSkinUrl(null); }
  }, []);

  useEffect(() => {
    if (skinUrl) {
      setSkinAnimTick((prev) => prev + 1);
    }
  }, [skinUrl]);

  useEffect(() => {
    let cancelled = false;
    const restoreActiveGame = async () => {
      setLd(true);
      try {
        const activeGame = await getActiveMinesGame();
        if (!activeGame || cancelled) {
          return;
        }
        setGame(activeGame);
        setBet((Number(activeGame.betAtomic) / COIN_DECIMALS).toFixed(2));
        setMc(activeGame.mineCount);
        const next = Array(BOARD).fill("hidden") as Cell[];
        activeGame.revealedCells?.forEach((i) => {
          if (i >= 0 && i < BOARD) {
            next[i] = "safe";
          }
        });
        setCells(next);
        setSafeCellGainByIndex({});
        await fetchSkin(activeGame.potentialPayoutAtomic);
      } catch {
        // Ignore restore errors to allow a normal fresh game.
      } finally {
        if (!cancelled) {
          setLd(false);
        }
      }
    };
    void restoreActiveGame();
    return () => {
      cancelled = true;
    };
  }, [fetchSkin]);

  const reset = () => {
    setCells(Array(BOARD).fill("hidden"));
    setLR(null);
    setSkinUrl(null);
    setSafeCellGainByIndex({});
  };
  const start = async () => {
    setErr(null); setLd(true); reset();
    try {
      const g = await startMinesGame("USDT", ba, mc); setGame(g); refreshBalance();
      if (g.revealedCells?.length) { const n = Array(BOARD).fill("hidden") as Cell[]; g.revealedCells.forEach((i) => (n[i] = "safe")); setCells(n); }
      fetchSkin(g.potentialPayoutAtomic);
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setLd(false); }
  };
  const reveal = async (idx: number) => {
    if (!game || cells[idx] !== "hidden" || !act) return;
    setErr(null); setLd(true);
    try {
      const previousPotentialAtomic = Number(game.potentialPayoutAtomic ?? game.betAtomic ?? "0");
      const r = await revealMine(game.gameId, idx); setGame(r); setLR(r.reveal);
      const n = [...cells];
      const newlySafe: number[] = [];
      let mineIdx: number | null = null;
      if (r.reveal.hitMine) {
        n[idx] = "mine";
        mineIdx = idx;
      } else {
        n[idx] = "safe";
        newlySafe.push(idx);
      }
      r.revealedCells?.forEach((i) => {
        if (n[i] === "hidden") {
          n[i] = "safe";
          newlySafe.push(i);
        }
      });
      setCells(n);
      const nextPotentialAtomic = Number(r.potentialPayoutAtomic ?? "0");
      const deltaAtomic = Number.isFinite(previousPotentialAtomic) && Number.isFinite(nextPotentialAtomic)
        ? Math.max(0, nextPotentialAtomic - previousPotentialAtomic)
        : 0;
      const deltaLabel = `+${(deltaAtomic / COIN_DECIMALS).toFixed(2)}`;
      if (newlySafe.length > 0) {
        setSafeCellGainByIndex((prev) => {
          const copy = { ...prev };
          newlySafe.forEach((safeIdx) => {
            if (!copy[safeIdx]) {
              copy[safeIdx] = deltaLabel;
            }
          });
          return copy;
        });
      }
      triggerCellAnimation(newlySafe, mineIdx);
      if (mineIdx !== null || r.status === "LOST") {
        playMineSfx();
      } else if (newlySafe.length > 0) {
        playGemSfx();
      }
      if (!r.reveal.hitMine && r.status === "ACTIVE") {
        fetchSkin(r.potentialPayoutAtomic);
      }
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setLd(false); }
  };
  const cashout = async () => {
    if (!game) return; setErr(null); setLd(true);
    try {
      const finished = await cashoutMines(game.gameId);
      setGame(finished);
      if (finished.status === "CASHED_OUT") {
        await fetchSkin(finished.payoutAtomic ?? finished.potentialPayoutAtomic ?? game.potentialPayoutAtomic);
        requestLiveWinsRefresh();
      } else {
        setSkinUrl(null);
      }
      refreshBalance();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setLd(false); }
  };
  const pickR = () => {
    if (!act) return;
    const h = cells.map((s, i) => s === "hidden" ? i : -1).filter((i) => i >= 0);
    if (h.length) reveal(h[Math.floor(Math.random() * h.length)]);
  };

  const pay = f(game?.potentialPayoutAtomic);

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
                <CoinIcon size={17} style={{ marginRight: 6 }} />
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

          {/* Red bar slider (supports click + drag) */}
          <div
            onPointerDown={(e) => {
              if (act) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              setDraggingBet(true);
              setBetFromClientX(e.clientX, e.currentTarget);
            }}
            onPointerMove={(e) => {
              if (!draggingBet || act) return;
              setBetFromClientX(e.clientX, e.currentTarget);
            }}
            onPointerUp={() => setDraggingBet(false)}
            onPointerCancel={() => setDraggingBet(false)}
            style={{
              position: "relative",
              height: 18,
              cursor: act ? "default" : "pointer",
              touchAction: "none",
              opacity: act ? 0.5 : 1
            }}
          >
            <div style={{
              width: "100%",
              height: 6,
              borderRadius: 999,
              background: "#2a2a2a",
              position: "absolute",
              top: 6,
              left: 0
            }} />
            <div style={{
              width: `${(betPct * 100).toFixed(3)}%`,
              height: 6,
              borderRadius: 999,
              background: "linear-gradient(90deg,#ac2e30,#f75154)",
              position: "absolute",
              top: 6,
              left: 0,
              boxShadow: "0 0 8px rgba(247,81,84,0.45)"
            }} />
            <div style={{
              position: "absolute",
              left: `${(betPct * 100).toFixed(3)}%`,
              top: "50%",
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "#ffffff",
              boxShadow: "0 0 0 2px rgba(172,46,48,0.5), 0 2px 8px rgba(0,0,0,0.35)",
              transform: "translate(-50%, -50%)"
            }} />
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
            background: cashedOut
              ? "radial-gradient(120% 85% at 50% 0%, rgba(74, 222, 96, 0.24) 0%, rgba(28, 78, 34, 0.22) 42%, #090909 100%)"
              : "#090909",
            border: cashedOut ? "1px solid rgba(74, 222, 96, 0.35)" : "1px solid transparent",
            boxShadow: cashedOut ? "inset 0 0 24px rgba(74, 222, 96, 0.16)" : "none",
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
                <img
                  key={`${skinUrl}-${skinAnimTick}`}
                  src={skinUrl}
                  alt=""
                  className={`mines-skin-preview ${lost ? "is-lost" : ""} ${cashedOut ? "is-cashed-out" : ""}`}
                  style={{ width: "100%", height: "100%", objectFit: "contain", position: "relative", zIndex: 1 }}
                />
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
                <div onClick={cashout} style={{ padding: "14px 24px", borderRadius: 12, background: "linear-gradient(180deg,#ac2e30,#f75154)", boxShadow: SR, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", opacity: ld ? 0.5 : 1 }}>
                  <span style={{ color: "#fff", fontSize: 16, fontFamily: G, fontWeight: 500, margin: 0 }}>
                    Cashout {pay}
                  </span>
                  <CoinIcon size={18} style={{ marginLeft: 6 }} />
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
              <div key={i} className={`mines-cell-mine ${cellAnim[i] === "mine" ? "is-reveal" : ""}`} style={{ width: "100%", aspectRatio: "107/109", borderRadius: 12, overflow: "hidden" }}>
                <img src={MINE_TILE} alt="mine" style={{ width: "100%", height: "100%", borderRadius: 12, display: "block" }} />
              </div>
            );
            if (st === "safe") return (
              <div key={i} className={`mines-cell-safe ${cellAnim[i] === "safe" ? "is-reveal" : ""}`} style={{ width: "100%", aspectRatio: "1", borderRadius: 12, overflow: "hidden", background: "linear-gradient(180deg,#4ade60,#2d8f35)", boxShadow: "0 3px 0 0 #0d2a0f, inset 0 2px 0 rgba(255,255,255,.12)", position: "relative" }}>
                <img src={GEM} alt="" style={{ width: "55%", height: "auto", position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -56%)" }} />
                <div style={{ position: "absolute", left: "50%", bottom: 14, transform: "translateX(-50%)" }}>
                  <CoinAmount
                    amount={(safeCellGainByIndex[i] ?? "+0.00").replace("+", "")}
                    prefix="+"
                    iconSize={15}
                    gap={2}
                    textStyle={{ color: "#0a2e0c", fontSize: 16, fontFamily: G, fontWeight: 700, margin: 0 }}
                  />
                </div>
              </div>
            );
            return (
              <img key={i} src={TILE} alt="" onClick={() => reveal(i)}
                style={{ width: "100%", aspectRatio: "107/109", borderRadius: 12, display: "block", boxShadow: "0 2px 0 0 #161616, inset 0 2px 0 0 rgba(255,255,255,.07)", cursor: act ? "pointer" : "default", opacity: act ? 1 : 0.5 }} />
            );
          })}
        </div>
      </div>
      <style jsx>{`
        .mines-skin-preview {
          filter: brightness(1);
          transform-origin: center center;
          will-change: transform, opacity, filter;
          animation:
            minesSkinAppear 320ms cubic-bezier(0.22, 1, 0.36, 1),
            minesSkinFloat 3.1s ease-in-out 320ms infinite;
        }

        .mines-skin-preview.is-lost {
          animation: minesSkinLost 220ms ease-out forwards;
        }

        .mines-skin-preview.is-cashed-out {
          filter: brightness(1.06) saturate(1.1) drop-shadow(0 0 16px rgba(74, 222, 96, 0.32));
        }

        @keyframes minesSkinAppear {
          0% {
            opacity: 0;
            transform: scale(0.72);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }

        @keyframes minesSkinFloat {
          0% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-4px);
          }
          100% {
            transform: translateY(0);
          }
        }

        @keyframes minesSkinLost {
          0% {
            filter: brightness(1);
            transform: translateY(0) scale(1);
          }
          100% {
            filter: brightness(0.4);
            transform: translateY(0) scale(1);
          }
        }

        .mines-cell-safe,
        .mines-cell-mine {
          will-change: transform, opacity, filter, box-shadow;
          transform-origin: center center;
        }

        .mines-cell-safe.is-reveal {
          animation: minesGemReveal 560ms cubic-bezier(0.18, 0.89, 0.32, 1.22);
        }

        .mines-cell-mine {
          position: relative;
        }

        .mines-cell-mine.is-reveal {
          animation: minesMineReveal 620ms cubic-bezier(0.2, 0.85, 0.28, 1);
        }

        .mines-cell-mine.is-reveal::after {
          content: "";
          position: absolute;
          inset: 15%;
          border-radius: 999px;
          pointer-events: none;
          background: radial-gradient(circle, rgba(255, 151, 108, 0.65) 0%, rgba(255, 90, 72, 0.22) 46%, rgba(255, 90, 72, 0) 74%);
          animation: minesMineBlast 520ms ease-out forwards;
        }

        @keyframes minesGemReveal {
          0% {
            opacity: 0;
            transform: translateY(14px) scale(0.74);
          }
          55% {
            opacity: 1;
            transform: translateY(-4px) scale(1.05);
          }
          100% {
            transform: translateY(0) scale(1);
          }
        }

        @keyframes minesMineReveal {
          0% {
            opacity: 0;
            transform: scale(0.68);
            filter: saturate(1.35) brightness(1.2);
          }
          45% {
            opacity: 1;
            transform: scale(1.08);
            filter: saturate(1.2) brightness(1.06);
          }
          100% {
            opacity: 1;
            transform: scale(1);
            filter: saturate(1) brightness(1);
          }
        }

        @keyframes minesMineBlast {
          0% {
            transform: scale(0.42);
            opacity: 0.85;
          }
          100% {
            transform: scale(1.6);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
