import { useState, useEffect, useCallback } from "react";
import { startBlackjackGame, actBlackjack, getActiveBlackjackGame, type BlackjackGame, type BlackjackAction } from "@/lib/api";
import { playDealSound, playWinSound, playLoseSound } from "@/lib/sounds";

const A = "/assets/";
const TABLE_IDLE = `${A}4d4f0838d8d221ce04032bc55f2eb265.png`;
const TABLE_ACTIVE = `${A}f8eee957459d78be189a8a4e8fc91da8.png`;
const TABLE_WIN = `${A}e5bb966fcbce61d0903ae1672af8ef80.png`;
const TABLE_LOSE = `${A}5ce16f3d9d067da2efb6a5fb48314eb1.png`;
const PLAY_ICON = `${A}2d7f2642f861986711d393c7536da7fc.svg`;

const G = '"DM Sans","Gotham",sans-serif';
const SUIT_SYM: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const SUIT_CLR: Record<string, string> = { S: "#1a1919", H: "#bd0926", D: "#bd0926", C: "#1a1919" };

function parseCard(c: string) { const s = c.slice(-1); return { rank: c.slice(0, -1).toUpperCase(), sym: SUIT_SYM[s] || "", clr: SUIT_CLR[s] || "#1a1919" }; }
function fmtCoins(v: string | null | undefined) { if (!v) return "0.00"; const n = Number(v) / 1e8; return isNaN(n) ? "0.00" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function Card({ code, faceDown, idx, flipping, splitOffset }: { code: string; faceDown?: boolean; idx: number; flipping?: boolean; splitOffset?: number }) {
  const { rank, sym, clr } = parseCard(code);
  const left = idx * 28 + (splitOffset || 0);
  const s: React.CSSProperties = {
    width: 65, height: 94, borderRadius: 7, position: "absolute", left, top: 0,
    animation: flipping ? "flipCard 0.4s ease-in-out forwards" : `dealCard 0.3s ease-out ${idx * 0.3}s both`,
  };
  if (faceDown) return (
    <div style={{ ...s, background: "linear-gradient(135deg,#1a1a1a,#2a2a2a)", border: "1px solid #444", boxShadow: "0 3px 8px rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 40, height: 58, borderRadius: 4, border: "1px solid #555", background: "repeating-linear-gradient(45deg,#222,#222 3px,#2a2a2a 3px,#2a2a2a 6px)" }} />
    </div>
  );
  return (
    <div style={{ ...s, background: "radial-gradient(circle at 30% 20%,#fff,#e0e0e0)", boxShadow: "0 3px 8px rgba(0,0,0,.25)", display: "flex", flexDirection: "column", padding: "4px 6px" }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: clr, lineHeight: "1", fontFamily: G }}>{rank}</span>
      <span style={{ fontSize: 10, color: clr, lineHeight: "1", marginTop: 1 }}>{sym}</span>
      <span style={{ fontSize: 22, color: clr, position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", opacity: 0.12 }}>{sym}</span>
    </div>
  );
}

function Chip({ val, label }: { val: string; label: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "radial-gradient(circle,#bd0926,#570411)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 3px", boxShadow: "inset 0 1px 0 #ad0822, inset 0 -1px 0 #3d1415" }}>
        <span style={{ color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: G }}>$</span>
      </div>
      <div style={{ background: "rgba(0,0,0,.7)", borderRadius: 8, padding: "2px 8px", marginBottom: 2, display: "inline-block" }}>
        <span style={{ color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: G }}>{val}</span>
      </div>
      <p style={{ color: "#828282", fontSize: 9, margin: 0, fontFamily: G }}>{label}</p>
    </div>
  );
}

export default function BlackjackPage() {
  const [game, setGame] = useState<BlackjackGame | null>(null);
  const [bet, setBet] = useState("10.00");
  const [sidePairs, setSidePairs] = useState("0");
  const [side21, setSide21] = useState("0");
  const [ld, setLd] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [revealedDealerCount, setRevealedDealerCount] = useState(0);
  const [revealing, setRevealing] = useState(false);

  const st = game?.status;
  const active = st === "ACTIVE";
  const won = st === "WON";
  const lost = st === "LOST";
  const push = st === "PUSH";
  const ended = won || lost || push;

  useEffect(() => {
    if (ended && game?.dealerRevealed) {
      const all = game.dealerCards || [];
      setRevealedDealerCount(1);
      setRevealing(true);
      const t: ReturnType<typeof setTimeout>[] = [];
      for (let i = 1; i < all.length; i++) t.push(setTimeout(() => { setRevealedDealerCount(i + 1); playDealSound(); }, i * 400));
      t.push(setTimeout(() => { setShowResult(true); setRevealing(false); if (game.status === "WON") playWinSound(); else if (game.status === "LOST") playLoseSound(); }, all.length * 400 + 300));
      return () => { t.forEach(clearTimeout); setRevealing(false); };
    } else { setShowResult(false); setRevealedDealerCount(0); setRevealing(false); }
  }, [ended, game?.dealerRevealed, game?.dealerCards, game?.status]);

  const tableImg = !game ? TABLE_IDLE : active ? TABLE_ACTIVE : (showResult ? TABLE_IDLE : TABLE_ACTIVE);
  const overlay = showResult ? (won ? TABLE_WIN : lost ? TABLE_LOSE : null) : null;

  const load = useCallback(async () => { try { const g = await getActiveBlackjackGame("USDT"); if (g) setGame(g); } catch {} }, []);
  useEffect(() => { load(); }, [load]);

  const play = async () => {
    if (ended) { setGame(null); setShowResult(false); setRevealedDealerCount(0); }
    setErr(null); setLd(true);
    try {
      const ba = String(Math.round(parseFloat(bet) * 1e8));
      const pv = parseFloat(sidePairs); const tv = parseFloat(side21);
      const g = await startBlackjackGame({ currency: "USDT", betAtomic: ba, ...(pv > 0 ? { sideBetPairsAtomic: String(Math.round(pv * 1e8)) } : {}), ...(tv > 0 ? { sideBet21Plus3Atomic: String(Math.round(tv * 1e8)) } : {}) });
      setGame(g);
      for (let i = 0; i < 4; i++) setTimeout(playDealSound, i * 300);
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setLd(false); }
  };

  const act = async (a: BlackjackAction) => {
    if (!game) return; setErr(null); setLd(true);
    try { const g = await actBlackjack(game.gameId, a); setGame(g); playDealSound(); } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setLd(false); }
  };

  const hands = game?.playerHands || [];
  const activeIdx = game?.activeHandIndex || 0;
  const hand = hands[activeIdx];
  const dCards = game?.dealerVisibleCards || [];
  const isSplit = hands.length > 1;

  const calcDisplay = (cards: string[]) => {
    let total = 0, aces = 0;
    for (const c of cards) { const r = c.slice(0, -1); if (r === "A") { total += 11; aces++; } else if (["K","Q","J"].includes(r)) total += 10; else total += parseInt(r); }
    const high = total;
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    if (aces > 0 && high <= 21 && total !== high) return `${total}/${high}`;
    return String(total);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {/* Table */}
      <div style={{ position: "relative", width: "100%", maxWidth: 800, aspectRatio: "988/682" }}>
        <img src={tableImg} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 16, position: "absolute", inset: 0 }} />
        {overlay && <img src={overlay} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 16, position: "absolute", inset: 0, pointerEvents: "none" }} />}

        {/* Deck */}
        <div style={{ position: "absolute", top: "3%", right: "22%", width: 40, height: 58, borderRadius: 5, background: "linear-gradient(135deg,#1a1a1a,#2a2a2a)", border: "1px solid #444", boxShadow: "2px 2px 0 #111, 4px 4px 0 #0a0a0a", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 26, height: 38, borderRadius: 3, border: "1px solid #555", background: "repeating-linear-gradient(45deg,#222,#222 3px,#2a2a2a 3px,#2a2a2a 6px)" }} />
        </div>

        {/* Dealer cards */}
        {game && dCards.length > 0 && (
          <div style={{ position: "absolute", top: "10%", left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ position: "relative", height: 98, width: (game.dealerRevealed ? Math.max(2, revealedDealerCount) : 2) * 28 + 65 }}>
              <Card code={dCards[0]} idx={0} />
              {!game.dealerRevealed ? <Card code="XX" idx={1} faceDown /> : (game.dealerCards || []).slice(1, revealedDealerCount).map((c, i) => <Card key={`d${i+1}`} code={c} idx={i+1} flipping={i === 0} />)}
            </div>
            <span style={{ background: "rgba(0,0,0,.75)", color: "#fff", padding: "2px 12px", borderRadius: 8, fontSize: 13, fontWeight: 700, fontFamily: G, marginTop: 2 }}>
              {game.dealerRevealed ? calcDisplay((game.dealerCards || []).slice(0, revealedDealerCount)) : calcDisplay([dCards[0]])}
            </span>
          </div>
        )}

        {/* Player cards — support split (two hands side by side) */}
        {hands.length > 0 && (
          <div style={{ position: "absolute", bottom: "22%", left: "50%", transform: "translateX(-50%)", display: "flex", gap: isSplit ? 40 : 0, alignItems: "flex-end" }}>
            {hands.map((h, hi) => (
              <div key={hi} style={{ display: "flex", flexDirection: "column", alignItems: "center", opacity: isSplit && hi !== activeIdx && active ? 0.5 : 1 }}>
                <div style={{ position: "relative", height: 98, width: h.cards.length * 28 + 65 }}>
                  {h.cards.map((c, ci) => <Card key={`p${hi}-${ci}`} code={c} idx={ci} />)}
                </div>
                <span style={{ background: "rgba(0,0,0,.75)", color: "#fff", padding: "2px 12px", borderRadius: 8, fontSize: 13, fontWeight: 700, fontFamily: G, marginTop: 2 }}>
                  {calcDisplay(h.cards)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Result */}
        {showResult && (
          <div style={{ position: "absolute", top: "44%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, fontFamily: G, padding: "5px 16px", borderRadius: 10, color: "#fff", background: won ? "rgba(34,197,94,.85)" : lost ? "rgba(239,68,68,.85)" : "rgba(100,100,100,.8)" }}>
              {won ? "YOU WIN!" : lost ? "LOSE" : "PUSH"}
            </div>
            {game?.payoutAtomic && <p style={{ color: "#55ff60", fontSize: 12, fontWeight: 700, marginTop: 3, fontFamily: G }}>+{fmtCoins(game.payoutAtomic)} COINS</p>}
          </div>
        )}

        {/* Chips on table */}
        <div style={{ position: "absolute", bottom: "6%", left: "50%", transform: "translateX(-50%)", display: "flex", gap: 24 }}>
          <Chip val={game ? fmtCoins(game.sideBetPairsAtomic) : sidePairs} label="Pairs" />
          <Chip val={game ? fmtCoins(game.mainBetAtomic) : bet} label="Bet" />
          <Chip val={game ? fmtCoins(game.sideBet21Plus3Atomic) : side21} label="21+3" />
        </div>
      </div>

      {/* Control bar */}
      <div style={{ width: "100%", maxWidth: 729, borderRadius: 20, padding: "12px 16px", marginTop: -20, background: "linear-gradient(180deg,#161616,#0d0d0d)", boxShadow: "0 -5px 30px #090909", position: "relative", zIndex: 10 }}>
        {!active ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            {/* 3 bet inputs in a row */}
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              {[
                { label: "21+3", val: side21, set: setSide21 },
                { label: "Bet", val: bet, set: setBet },
                { label: "Pairs", val: sidePairs, set: setSidePairs },
              ].map((inp) => (
                <div key={inp.label} style={{ flex: 1, textAlign: "center" }}>
                  <p style={{ color: "#828282", fontSize: 11, margin: "0 0 4px", fontFamily: G }}>{inp.label}</p>
                  <div style={{ display: "flex", alignItems: "center", background: "#090909", borderRadius: 12, padding: "0 4px 0 0", height: 42 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "radial-gradient(circle,#bd0926,#570411)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 6px", flexShrink: 0, boxShadow: "inset 0 1px 0 #ad0822, inset 0 -1px 0 #3d1415" }}>
                      <span style={{ color: "#fff", fontSize: 12, fontWeight: 700, fontFamily: G }}>$</span>
                    </div>
                    <input value={inp.val} onChange={(e) => inp.set(e.target.value)}
                      style={{ flex: 1, height: "100%", border: "none", outline: "none", background: "transparent", color: "#fff", fontSize: 16, fontFamily: G, fontWeight: 500, padding: 0, minWidth: 0 }} />
                  </div>
                </div>
              ))}
            </div>
            {/* Play button */}
            <button onClick={play} disabled={ld || revealing} style={{ width: 181, height: 48, borderRadius: 12, border: "none", cursor: ld || revealing ? "default" : "pointer", background: "linear-gradient(180deg,#ac2e30,#f75154)", boxShadow: "inset 0 1px 0 #f24f51, inset 0 -1px 0 #ff7476", color: "#fff", fontSize: 18, fontWeight: 600, fontFamily: G, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: ld || revealing ? 0.5 : 1 }}>
              <img src={PLAY_ICON} alt="" style={{ width: 20, height: 20 }} /> Play
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            {([
              { a: "HIT" as BlackjackAction, l: "Hit", dis: ld, icon: "➕", iconBg: "#22c55e" },
              { a: "STAND" as BlackjackAction, l: "Stand", dis: ld, icon: "🛑", iconBg: "#ef4444" },
              { a: "SPLIT" as BlackjackAction, l: "Split", dis: ld || !game?.canSplit, icon: "↔", iconBg: "#3b82f6" },
              { a: "DOUBLE" as BlackjackAction, l: "Double", dis: ld || (hand?.cards.length || 0) > 2, icon: "⬆", iconBg: "#f59e0b" },
            ]).map(({ a, l, dis, icon, iconBg }) => (
              <button key={a} onClick={() => !dis && act(a)} disabled={dis}
                style={{
                  flex: 1, height: 52, borderRadius: 14, border: "1px solid #2a2a2a",
                  cursor: dis ? "default" : "pointer",
                  background: "linear-gradient(180deg,#1e1e1e,#141414)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  color: "#fff", fontSize: 16, fontWeight: 500, fontFamily: G,
                  opacity: dis ? 0.3 : 1,
                }}>
                <span style={{ width: 24, height: 24, borderRadius: "50%", background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, lineHeight: "1" }}>{icon}</span>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>

      {err && <p style={{ color: "#f34950", fontSize: 12, fontFamily: G, margin: "4px 0 0" }}>{err}</p>}
    </div>
  );
}
