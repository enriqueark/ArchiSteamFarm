import { useState, useEffect, useCallback } from "react";
import { startBlackjackGame, actBlackjack, getActiveBlackjackGame, type BlackjackGame, type BlackjackAction } from "@/lib/api";
import { playDealSound, playWinSound, playLoseSound } from "@/lib/sounds";
import { refreshBalance } from "@/lib/refreshBalance";

const A = "/assets/";
const TABLE_IDLE = `${A}4d4f0838d8d221ce04032bc55f2eb265.png`;
const TABLE_ACTIVE = `${A}f8eee957459d78be189a8a4e8fc91da8.png`;
const TABLE_WIN = `${A}e5bb966fcbce61d0903ae1672af8ef80.png`;
const TABLE_LOSE = `${A}5ce16f3d9d067da2efb6a5fb48314eb1.png`;
const PLAY_ICON = `${A}2d7f2642f861986711d393c7536da7fc.svg`;

const G = '"DM Sans","Gotham",sans-serif';
const SUIT_SYM: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const SUIT_CLR: Record<string, string> = { S: "#1a1919", H: "#bd0926", D: "#bd0926", C: "#1a1919" };
const SUIT_SMALL: Record<string, string> = {
  S: `${A}c159c3c1a437c5d39970f25abe1b18d2.svg`,
  H: `${A}0f43ed60dcc8b6ae1a74191048e1117b.svg`,
  D: `${A}07a4e3a803710f1d2d80fdc2381a73a6.svg`,
  C: `${A}2ed3a41c759a01c6b7ca40c12100d1a8.svg`,
};
const SUIT_LARGE: Record<string, string> = {
  S: `${A}fdad942d9caab4040db40feb9116c57c.svg`,
  H: `${A}1fbe0a4cfdf293e8b30050ea6359c066.svg`,
  D: `${A}1f0f7bc2f4657e040fd8e5d31d9b07da.svg`,
  C: `${A}1e208e0bd7c4587a8979024e10d4792e.svg`,
};

function parseCard(c: string) { const s = c.slice(-1); return { rank: c.slice(0, -1).toUpperCase(), suit: s, sym: SUIT_SYM[s] || "", clr: SUIT_CLR[s] || "#1a1919" }; }
function fmtCoins(v: string | null | undefined) { if (!v) return "0.00"; const n = Number(v) / 1e8; return isNaN(n) ? "0.00" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function Card({ code, faceDown, idx, flipping, splitOffset, tiltDeg = 0 }: { code: string; faceDown?: boolean; idx: number; flipping?: boolean; splitOffset?: number; tiltDeg?: number }) {
  const { rank, suit, clr } = parseCard(code);
  const left = idx * 40 + (splitOffset || 0);
  const scale = 0.64;
  const w = 150 * scale;
  const h = 210 * scale;
  const base: React.CSSProperties = {
    width: w, height: h, borderRadius: 20 * scale, position: "absolute", left, top: 0,
    animation: flipping ? "flipCard 0.4s ease-in-out forwards" : `dealCard 0.3s ease-out ${idx * 0.3}s both`,
    transform: `rotate(${tiltDeg}deg)`,
    transformOrigin: "50% 85%"
  };

  if (faceDown) {
    return (
      <div
        style={{
          ...base,
          background: "linear-gradient(135deg,#1a1a1a,#2a2a2a)",
          border: "1px solid #444",
          boxShadow: "2px 2px 0 #111, 4px 4px 0 #0a0a0a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: 26 * (w / 40),
            height: 38 * (h / 58),
            borderRadius: 3 * (w / 40),
            border: "1px solid #555",
            background: "repeating-linear-gradient(45deg,#222,#222 3px,#2a2a2a 3px,#2a2a2a 6px)",
          }}
        />
      </div>
    );
  }

  const smallSvg = SUIT_SMALL[suit];
  const largeSvg = SUIT_LARGE[suit];

  return (
    <div style={{
      ...base,
      background: "radial-gradient(circle, #fff 0%, #dadada 100%)",
      boxShadow: "inset 0 1px 0 0 rgba(0,0,0,.07), 0 2px 14px 0 rgba(0,0,0,.29)",
      overflow: "hidden",
    }}>
      {/* Inner border rectangle */}
      <div style={{
        position: "absolute", inset: 4 * scale,
        border: `1px solid ${clr}`,
        borderRadius: 13 * scale,
        boxSizing: "border-box",
      }} />
      {/* Rank text top-left */}
      <span style={{
        position: "absolute", top: 8 * scale, left: 12 * scale,
        fontSize: 32 * scale, fontWeight: 700, color: clr, lineHeight: "1", fontFamily: G,
      }}>{rank}</span>
      {/* Small suit under rank */}
      {smallSvg && <img src={smallSvg} alt="" style={{ position: "absolute", top: 42 * scale, left: 10 * scale, width: 24 * scale, height: 24 * scale }} />}
      {/* Large suit bottom-right (as reference) */}
      {largeSvg && <img src={largeSvg} alt="" style={{
        position: "absolute",
        bottom: 12 * scale,
        right: 12 * scale,
        width: 70 * scale,
        height: 70 * scale,
      }} />}
    </div>
  );
}

function Chip({ val, label }: { val: string; label: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          height: 44,
          borderRadius: 10,
          background: "linear-gradient(180deg,#161616,#0d0d0d)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "0 14px",
          boxShadow: "inset 0 1px 0 #252525, inset 0 -1px 0 #242424"
        }}
      >
        <div style={{ width: 22, height: 22, borderRadius: "50%", background: "radial-gradient(circle,#bd0926,#570411)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "inset 0 1px 0 #ad0822, inset 0 -1px 0 #3d1415" }}>
          <span style={{ color: "#fff", fontSize: 10, fontWeight: 700, fontFamily: G }}>$</span>
        </div>
        <span style={{ color: "#fff", fontSize: 18, fontWeight: 700, fontFamily: G }}>{val}</span>
      </div>
      <p style={{ color: "#ffffff", fontSize: 15, margin: "8px 0 0", fontFamily: G, fontWeight: 600 }}>{label}</p>
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
      t.push(setTimeout(() => { setShowResult(true); setRevealing(false); refreshBalance(); if (game.status === "WON") playWinSound(); else if (game.status === "LOST") playLoseSound(); }, all.length * 400 + 300));
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
      const g = await startBlackjackGame({ currency: "USDT", betAtomic: ba, ...(pv > 0 ? { sideBetPairsAtomic: String(Math.round(pv * 1e8)) } : {}), ...(tv > 0 ? { sideBet21Plus3Atomic: String(Math.round(tv * 1e8)) } : {}) }); refreshBalance();
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
  const dealerDisplayCards = game?.dealerRevealed ? (game.dealerCards || []).slice(0, Math.max(1, revealedDealerCount)) : dCards;

  const calcDisplay = (cards: string[]) => {
    let total = 0, aces = 0;
    for (const c of cards) { const r = c.slice(0, -1); if (r === "A") { total += 11; aces++; } else if (["K","Q","J"].includes(r)) total += 10; else total += parseInt(r); }
    const high = total;
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    if (aces > 0 && high <= 21 && total !== high) return `${total}/${high}`;
    return String(total);
  };

  const renderActionIcon = (kind: "hit" | "stand" | "split" | "double") => {
    if (kind === "double") {
      return (
        <span
          style={{
            width: 28,
            height: 28,
            clipPath: "polygon(25% 6%, 75% 6%, 94% 50%, 75% 94%, 25% 94%, 6% 50%)",
            background: "#ffc844",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 7L7 3.2L11 7" stroke="#0b0c0f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 10.8L7 7L11 10.8" stroke="#0b0c0f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      );
    }

    const bg = kind === "hit" ? "#43ff69" : kind === "stand" ? "#d70d33" : "#58bcff";
    const glyph = (
      <>
        {kind === "hit" && (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 2.4V11.6M2.4 7H11.6" stroke="#0b0c0f" strokeWidth="2.3" strokeLinecap="round" />
          </svg>
        )}
        {kind === "stand" && (
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <path d="M11.8 6.6a5.1 5.1 0 1 1-4.7-5.1" stroke="#0b0c0f" strokeWidth="2.1" strokeLinecap="round" />
            <path d="M8.2 1.6H12v3.8" stroke="#0b0c0f" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {kind === "split" && (
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <path d="M7.5 12.4V7.4" stroke="#0b0c0f" strokeWidth="2.1" strokeLinecap="round" />
            <path d="M7.5 7.4L4.4 4.1M7.5 7.4L10.6 4.1" stroke="#0b0c0f" strokeWidth="2.1" strokeLinecap="round" />
            <path d="M4.4 4.1H6.4M4.4 4.1V6.1" stroke="#0b0c0f" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10.6 4.1H8.6M10.6 4.1V6.1" stroke="#0b0c0f" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </>
    );

    return (
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0
        }}
      >
        {glyph}
      </span>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {/* Table */}
      <div style={{ position: "relative", width: "100%", maxWidth: 860, aspectRatio: "988/682" }}>
        <img src={tableImg} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 16, position: "absolute", inset: 0 }} />
        {overlay && <img src={overlay} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 16, position: "absolute", inset: 0, pointerEvents: "none" }} />}

        {/* Deck */}
        <div style={{ position: "absolute", top: "3%", right: "22%", width: 40, height: 58, borderRadius: 5, background: "linear-gradient(135deg,#1a1a1a,#2a2a2a)", border: "1px solid #444", boxShadow: "2px 2px 0 #111, 4px 4px 0 #0a0a0a", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 26, height: 38, borderRadius: 3, border: "1px solid #555", background: "repeating-linear-gradient(45deg,#222,#222 3px,#2a2a2a 3px,#2a2a2a 6px)" }} />
        </div>

        {/* Dealer cards */}
        {game && dCards.length > 0 && (
          <div style={{ position: "absolute", top: "9%", left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ position: "relative", height: 110, width: (game.dealerRevealed ? Math.max(2, revealedDealerCount) : 2) * 40 + 74 }}>
              <Card code={dCards[0]} idx={0} />
              {!game.dealerRevealed ? <Card code="XX" idx={1} faceDown /> : (game.dealerCards || []).slice(1, revealedDealerCount).map((c, i) => <Card key={`d${i+1}`} code={c} idx={i+1} flipping={i === 0} />)}
            </div>
            <div style={{ marginTop: 34, textAlign: "center" }}>
              <span style={{
                display: "inline-flex",
                minWidth: 30,
                height: 30,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 999,
                padding: "0 12px",
                background: "rgba(0,0,0,0.5)",
                color: "#d3d7dd",
                fontSize: 18,
                fontWeight: 700,
                fontFamily: G
              }}>
                {calcDisplay(dealerDisplayCards)}
              </span>
            </div>
          </div>
        )}

        {/* Player cards — support split (two hands side by side) */}
        {hands.length > 0 && (
          <div style={{ position: "absolute", bottom: "19.5%", left: "50%", transform: "translateX(-50%)", display: "flex", gap: isSplit ? 40 : 0, alignItems: "flex-end" }}>
            {hands.map((h, hi) => (
              <div key={hi} style={{ display: "flex", flexDirection: "column", alignItems: "center", opacity: isSplit && hi !== activeIdx && active ? 0.5 : 1 }}>
                <div style={{ position: "relative", height: 110, width: h.cards.length * 40 + 74 }}>
                  {h.cards.map((c, ci) => <Card key={`p${hi}-${ci}`} code={c} idx={ci} tiltDeg={ci === 0 ? -6 : 5} />)}
                </div>
                <span style={{
                  display: "inline-flex",
                  minWidth: 30,
                  height: 30,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 999,
                  padding: "0 12px",
                  background: "rgba(0,0,0,0.56)",
                  color: "#d3d7dd",
                  fontSize: 18,
                  fontWeight: 700,
                  fontFamily: G,
                  marginTop: 34
                }}>
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
        <div style={{ position: "absolute", bottom: "4.5%", left: "50%", transform: "translateX(-50%)", display: "flex", gap: 22 }}>
          <Chip val={game ? fmtCoins(game.sideBet21Plus3Atomic) : side21} label="21+3" />
          <Chip val={game ? fmtCoins(game.mainBetAtomic) : bet} label="Bet" />
          <Chip val={game ? fmtCoins(game.sideBetPairsAtomic) : sidePairs} label="Pairs" />
        </div>
      </div>

      {/* Control bar */}
      <div style={{ width: "100%", maxWidth: 740, borderRadius: 20, padding: "12px 16px", marginTop: -20, background: "linear-gradient(180deg,#161616,#0d0d0d)", boxShadow: "0 -5px 30px #090909", position: "relative", zIndex: 10 }}>
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
                  <div style={{ display: "flex", alignItems: "center", background: "#090909", borderRadius: 12, padding: "0 4px 0 0", height: 42 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "radial-gradient(circle,#bd0926,#570411)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 6px", flexShrink: 0, boxShadow: "inset 0 1px 0 #ad0822, inset 0 -1px 0 #3d1415" }}>
                      <span style={{ color: "#fff", fontSize: 12, fontWeight: 700, fontFamily: G }}>$</span>
                    </div>
                    <input value={inp.val} onChange={(e) => inp.set(e.target.value)}
                      style={{ flex: 1, height: "100%", border: "none", outline: "none", background: "transparent", color: "#fff", fontSize: 16, fontFamily: G, fontWeight: 500, padding: 0, minWidth: 0 }} />
                  </div>
                  <p style={{ color: "#828282", fontSize: 11, margin: "5px 0 0", fontFamily: G }}>{inp.label}</p>
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
              { a: "HIT" as BlackjackAction, l: "Hit", dis: ld, icon: "hit" as const },
              { a: "STAND" as BlackjackAction, l: "Stand", dis: ld, icon: "stand" as const },
              { a: "SPLIT" as BlackjackAction, l: "Split", dis: ld || !game?.canSplit, icon: "split" as const },
              { a: "DOUBLE" as BlackjackAction, l: "Double", dis: ld || (hand?.cards.length || 0) > 2, icon: "double" as const },
            ]).map(({ a, l, dis, icon }) => (
              <button key={a} onClick={() => !dis && act(a)} disabled={dis}
                style={{
                  flex: 1, minHeight: 50, padding: "14px 16px", borderRadius: 12, border: "none",
                  cursor: dis ? "default" : "pointer",
                  background: "#1a1a1a",
                  boxShadow: "inset 0 1px 0 #252525, inset 0 -1px 0 #242424",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                  color: "#fff", fontSize: 16, fontWeight: 600, fontFamily: G,
                  opacity: dis ? 0.3 : 1,
                }}>
                {renderActionIcon(icon)}
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
