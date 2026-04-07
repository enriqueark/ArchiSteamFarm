import { useState, useEffect, useCallback, useRef } from "react";
import {
  startBlackjackGame, actBlackjack, getActiveBlackjackGame,
  type BlackjackGame, type BlackjackAction,
} from "@/lib/api";
import { playDealSound, playWinSound, playLoseSound } from "@/lib/sounds";

const A = "/assets/";
const TABLE_IDLE = `${A}4d4f0838d8d221ce04032bc55f2eb265.png`;
const TABLE_ACTIVE = `${A}f8eee957459d78be189a8a4e8fc91da8.png`;
const TABLE_WIN = `${A}e5bb966fcbce61d0903ae1672af8ef80.png`;
const TABLE_LOSE = `${A}5ce16f3d9d067da2efb6a5fb48314eb1.png`;

const G = '"DM Sans","Gotham",sans-serif';
const SUIT_SYM: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const SUIT_CLR: Record<string, string> = { S: "#1a1919", H: "#bd0926", D: "#bd0926", C: "#1a1919" };

function parseCard(c: string) {
  const suit = c.slice(-1);
  const rank = c.slice(0, -1).toUpperCase();
  return { rank, suit, sym: SUIT_SYM[suit] || "", clr: SUIT_CLR[suit] || "#1a1919" };
}

function fmtCoins(v: string | null | undefined): string {
  if (!v) return "0.00";
  const n = Number(v) / 1e8;
  return isNaN(n) ? "0.00" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Card({ code, faceDown, idx, flipping }: { code: string; faceDown?: boolean; idx: number; flipping?: boolean }) {
  const { rank, sym, clr } = parseCard(code);
  const left = idx * 30;
  const base: React.CSSProperties = {
    width: 70, height: 100, borderRadius: 8, position: "absolute", left, top: 0,
    animation: flipping ? `flipCard 0.5s ease-in-out forwards` : `dealCard 0.35s ease-out ${idx * 0.35}s both`,
  };

  if (faceDown) return (
    <div style={{ ...base, background: "linear-gradient(135deg, #1a1a1a, #2a2a2a)", border: "1px solid #444", boxShadow: "0 4px 10px rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 44, height: 62, borderRadius: 5, border: "1px solid #555", background: "repeating-linear-gradient(45deg,#222,#222 4px,#2a2a2a 4px,#2a2a2a 8px)" }} />
    </div>
  );

  return (
    <div style={{ ...base, background: "radial-gradient(circle at 30% 20%, #fff, #e0e0e0)", boxShadow: "0 3px 10px rgba(0,0,0,.25)", display: "flex", flexDirection: "column", padding: "5px 7px" }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: clr, lineHeight: "1", fontFamily: G }}>{rank}</span>
      <span style={{ fontSize: 11, color: clr, lineHeight: "1", marginTop: 1 }}>{sym}</span>
      <span style={{ fontSize: 26, color: clr, position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", opacity: 0.12 }}>{sym}</span>
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
  const prevCardCount = useRef(0);

  const st = game?.status;
  const active = st === "ACTIVE";
  const won = st === "WON";
  const lost = st === "LOST";
  const push = st === "PUSH";
  const ended = won || lost || push;

  useEffect(() => {
    if (ended && game?.dealerRevealed) {
      const allCards = game.dealerCards || [];
      setRevealedDealerCount(1);
      const timers: ReturnType<typeof setTimeout>[] = [];
      for (let i = 1; i < allCards.length; i++) {
        timers.push(setTimeout(() => { setRevealedDealerCount(i + 1); playDealSound(); }, i * 500));
      }
      timers.push(setTimeout(() => {
        setShowResult(true);
        if (game.status === "WON") playWinSound();
        else if (game.status === "LOST") playLoseSound();
      }, allCards.length * 500 + 300));
      return () => timers.forEach(clearTimeout);
    } else {
      setShowResult(false);
      setRevealedDealerCount(0);
    }
  }, [ended, game?.dealerRevealed, game?.dealerCards]);

  const tableImg = !game ? TABLE_IDLE : active ? TABLE_ACTIVE : (showResult ? TABLE_IDLE : TABLE_ACTIVE);
  const tableOverlay = showResult ? (won ? TABLE_WIN : lost ? TABLE_LOSE : null) : null;

  const load = useCallback(async () => {
    try { const g = await getActiveBlackjackGame("USDT"); if (g) setGame(g); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const play = async () => {
    if (ended) { setGame(null); setShowResult(false); setRevealedDealerCount(0); }
    setErr(null); setLd(true);
    try {
      const betAtomic = String(Math.round(parseFloat(bet) * 1e8));
      const pv = parseFloat(sidePairs);
      const tv = parseFloat(side21);
      const g = await startBlackjackGame({
        currency: "USDT",
        betAtomic,
        ...(pv > 0 ? { sideBetPairsAtomic: String(Math.round(pv * 1e8)) } : {}),
        ...(tv > 0 ? { sideBet21Plus3Atomic: String(Math.round(tv * 1e8)) } : {}),
      });
      setGame(g);
      playDealSound();
      setTimeout(playDealSound, 350);
      setTimeout(playDealSound, 700);
      setTimeout(playDealSound, 1050);
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setLd(false); }
  };

  const act = async (action: BlackjackAction) => {
    if (!game) return;
    setErr(null); setLd(true);
    try { const g = await actBlackjack(game.gameId, action); setGame(g); playDealSound(); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setLd(false); }
  };

  const hand = game?.playerHands?.[game.activeHandIndex || 0];
  const dCards = game?.dealerVisibleCards || [];

  const calcVal = (cards: string[]) => cards.reduce((s: number, c: string) => {
    const r = c.slice(0, -1);
    let v = r === "A" ? 11 : ["K", "Q", "J"].includes(r) ? 10 : parseInt(r);
    return s + v;
  }, 0);

  const dealerVisibleVal = dCards.length > 0
    ? game?.dealerRevealed
      ? calcVal((game.dealerCards || []).slice(0, revealedDealerCount || 1))
      : calcVal([dCards[0]])
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {/* Table container */}
      <div style={{ position: "relative", width: "100%", maxWidth: 800, aspectRatio: "988/682" }}>
        {/* Base table */}
        <img src={tableImg} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 16, position: "absolute", inset: 0 }} />

        {/* Win/lose overlay */}
        {tableOverlay && (
          <img src={tableOverlay} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 16, position: "absolute", inset: 0, pointerEvents: "none" }} />
        )}

        {/* Card deck (top right inside table) */}
        <div style={{ position: "absolute", top: "3%", right: "22%", width: 44, height: 62, borderRadius: 5, background: "linear-gradient(135deg,#1a1a1a,#2a2a2a)", border: "1px solid #444", boxShadow: "2px 2px 0 #111, 4px 4px 0 #0a0a0a", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 28, height: 40, borderRadius: 3, border: "1px solid #555", background: "repeating-linear-gradient(45deg,#222,#222 3px,#2a2a2a 3px,#2a2a2a 6px)" }} />
        </div>

        {/* Dealer cards */}
        {game && dCards.length > 0 && (
          <div style={{ position: "absolute", top: "10%", left: "50%", transform: "translateX(-40%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ position: "relative", height: 105, width: (game?.dealerRevealed ? Math.max(2, revealedDealerCount) : 2) * 30 + 70 }}>
              <Card code={dCards[0]} idx={0} />
              {!game?.dealerRevealed ? (
                <Card code="XX" idx={1} faceDown />
              ) : (
                (game.dealerCards || []).slice(1, revealedDealerCount).map((c, i) => (
                  <Card key={`d${i + 1}`} code={c} idx={i + 1} flipping={i === 0} />
                ))
              )}
            </div>
            <span style={{ background: "rgba(0,0,0,.75)", color: "#fff", padding: "3px 14px", borderRadius: 8, fontSize: 13, fontWeight: 700, fontFamily: G, marginTop: 4, alignSelf: "center" }}>{dealerVisibleVal}</span>
          </div>
        )}

        {/* Player cards */}
        {hand && (
          <div style={{ position: "absolute", bottom: "22%", left: "50%", transform: "translateX(-40%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ position: "relative", height: 105, width: hand.cards.length * 30 + 70 }}>
              {hand.cards.map((c, i) => <Card key={`p${i}`} code={c} idx={i} />)}
            </div>
            <span style={{ background: "rgba(0,0,0,.75)", color: "#fff", padding: "3px 14px", borderRadius: 8, fontSize: 13, fontWeight: 700, fontFamily: G, marginTop: 4, alignSelf: "center" }}>{hand.value}</span>
          </div>
        )}

        {/* Result overlay text — only after reveal delay */}
        {showResult && (
          <div style={{ position: "absolute", top: "44%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: G, padding: "6px 18px", borderRadius: 10, color: "#fff", background: won ? "rgba(34,197,94,.85)" : lost ? "rgba(239,68,68,.85)" : "rgba(100,100,100,.8)" }}>
              {won ? "YOU WIN!" : lost ? "LOSE" : "PUSH"}
            </div>
            {game?.payoutAtomic && <p style={{ color: "#55ff60", fontSize: 13, fontWeight: 700, marginTop: 4, fontFamily: G }}>+{fmtCoins(game.payoutAtomic)} COINS</p>}
          </div>
        )}

        {/* Bet chips ON the table (bottom area) */}
        <div style={{ position: "absolute", bottom: "6%", left: "50%", transform: "translateX(-50%)", display: "flex", gap: 24, alignItems: "flex-end" }}>
          {[
            { label: "Pairs", val: game ? fmtCoins(game.sideBetPairsAtomic) : sidePairs },
            { label: "Bet", val: game ? fmtCoins(game.mainBetAtomic) : bet },
            { label: "21+3", val: game ? fmtCoins(game.sideBet21Plus3Atomic) : side21 },
          ].map((chip) => (
            <div key={chip.label} style={{ textAlign: "center" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "radial-gradient(circle,#bd0926,#570411)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 4px", boxShadow: "inset 0 1px 0 #ad0822, inset 0 -1px 0 #3d1415" }}>
                <span style={{ color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: G }}>$</span>
              </div>
              <div style={{ background: "rgba(0,0,0,.7)", borderRadius: 8, padding: "3px 10px", marginBottom: 2 }}>
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: G }}>{chip.val}</span>
              </div>
              <p style={{ color: "#828282", fontSize: 9, margin: 0, fontFamily: G }}>{chip.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Control bar — overlapping table bottom */}
      <div style={{
        width: "100%", maxWidth: 730, borderRadius: 20, padding: "12px 20px", marginTop: -24,
        background: "linear-gradient(180deg, #161616, #0d0d0d)",
        boxShadow: "0 -5px 30px #090909",
        display: "flex", alignItems: "center", gap: 12, position: "relative", zIndex: 10,
      }}>
        {!active ? (
          <>
            <div style={{ flex: 1, display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <p style={{ color: "#828282", fontSize: 10, margin: "0 0 3px", fontFamily: G }}>Main bet (COINS)</p>
                <input value={bet} onChange={(e) => setBet(e.target.value)}
                  style={{ width: "100%", height: 34, borderRadius: 10, border: "none", outline: "none", background: "#090909", color: "#fff", fontSize: 14, fontFamily: G, fontWeight: 500, padding: "0 10px", boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: "#828282", fontSize: 10, margin: "0 0 3px", fontFamily: G }}>Pairs side bet (optional)</p>
                <input value={sidePairs} onChange={(e) => setSidePairs(e.target.value)}
                  style={{ width: "100%", height: 34, borderRadius: 10, border: "none", outline: "none", background: "#090909", color: "#fff", fontSize: 14, fontFamily: G, fontWeight: 500, padding: "0 10px", boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: "#828282", fontSize: 10, margin: "0 0 3px", fontFamily: G }}>21+3 side bet (optional)</p>
                <input value={side21} onChange={(e) => setSide21(e.target.value)}
                  style={{ width: "100%", height: 34, borderRadius: 10, border: "none", outline: "none", background: "#090909", color: "#fff", fontSize: 14, fontFamily: G, fontWeight: 500, padding: "0 10px", boxSizing: "border-box" }} />
              </div>
            </div>
            <button onClick={play} disabled={ld}
              style={{ height: 42, paddingLeft: 22, paddingRight: 22, borderRadius: 12, border: "none", cursor: "pointer", background: "linear-gradient(180deg,#ac2e30,#f75154)", boxShadow: "inset 0 1px 0 #f24f51, inset 0 -1px 0 #ff7476", color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: G, display: "flex", alignItems: "center", gap: 6, opacity: ld ? 0.5 : 1, whiteSpace: "nowrap" }}>
              ▶ Play
            </button>
          </>
        ) : (
          <div style={{ display: "flex", gap: 8, width: "100%", justifyContent: "center" }}>
            {(["HIT", "STAND", "DOUBLE"] as BlackjackAction[]).map((a) => {
              const isStand = a === "STAND";
              const dis = ld || (a === "DOUBLE" && (hand?.cards.length || 0) > 2);
              return (
                <button key={a} onClick={() => act(a)} disabled={dis}
                  style={{
                    flex: 1, height: 48, borderRadius: 14, border: "none", cursor: dis ? "default" : "pointer",
                    background: isStand ? "linear-gradient(180deg,#ac2e30,#f75154)" : "#1a1a1a",
                    boxShadow: isStand ? "inset 0 1px 0 #f24f51, inset 0 -1px 0 #ff7476" : "inset 0 1px 0 #252525, inset 0 -1px 0 #242424",
                    color: "#fff", fontSize: 16, fontWeight: 500, fontFamily: G, opacity: dis ? 0.3 : 1,
                  }}>
                  {a.charAt(0) + a.slice(1).toLowerCase()}
                </button>
              );
            })}
            {game?.canSplit && (
              <button onClick={() => act("SPLIT")} disabled={ld}
                style={{ flex: 1, height: 48, borderRadius: 14, border: "none", cursor: "pointer", background: "#1a1a1a", boxShadow: "inset 0 1px 0 #252525, inset 0 -1px 0 #242424", color: "#fff", fontSize: 16, fontWeight: 500, fontFamily: G, opacity: ld ? 0.3 : 1 }}>
                Split
              </button>
            )}
            {game?.canInsurance && (
              <button onClick={() => act("INSURANCE")} disabled={ld}
                style={{ flex: 1, height: 48, borderRadius: 14, border: "none", cursor: "pointer", background: "#1a1a1a", boxShadow: "inset 0 1px 0 #252525, inset 0 -1px 0 #242424", color: "#828282", fontSize: 16, fontWeight: 500, fontFamily: G, opacity: ld ? 0.3 : 1 }}>
                Insurance
              </button>
            )}
          </div>
        )}
      </div>

      {err && <p style={{ color: "#f34950", fontSize: 12, fontFamily: G, margin: "6px 0 0" }}>{err}</p>}
      {!active && !ended && <p style={{ color: "#828282", fontSize: 11, fontFamily: G, margin: "4px 0 0" }}>Side bets are optional.</p>}
    </div>
  );
}
