import { useState, useEffect, useCallback } from "react";
import {
  startBlackjackGame, actBlackjack, getActiveBlackjackGame,
  type BlackjackGame, type BlackjackAction,
} from "@/lib/api";

const A = "/assets/";
const TABLE_IDLE = `${A}863ee14829df4334294390c64488345c.png`;
const TABLE_ACTIVE = `${A}f8eee957459d78be189a8a4e8fc91da8.png`;
const TABLE_WIN = `${A}e5bb966fcbce61d0903ae1672af8ef80.png`;
const TABLE_LOSE = `${A}5ce16f3d9d067da2efb6a5fb48314eb1.png`;
const CARD_BACK = `${A}69e6f934709c04b3cc4289edf9df5676.svg`;
const PLAY_ICON = `${A}2d7f2642f861986711d393c7536da7fc.svg`;

const G = '"DM Sans","Gotham",sans-serif';

const SUIT_SYMBOLS: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const SUIT_COLORS: Record<string, string> = { S: "#1a1919", H: "#bd0926", D: "#bd0926", C: "#1a1919" };

function parseCard(code: string): { rank: string; suit: string; display: string } {
  const suit = code.slice(-1);
  const rank = code.slice(0, -1);
  const displayRank = rank === "10" ? "10" : rank.toUpperCase();
  return { rank: displayRank, suit, display: `${displayRank}${SUIT_SYMBOLS[suit] || ""}` };
}

function fmtCoins(v: string | null | undefined): string {
  if (!v) return "0.00";
  const n = Number(v) / 1e8;
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

function CardComponent({ code, faceDown, idx, isDealer }: { code: string; faceDown?: boolean; idx: number; isDealer?: boolean }) {
  const { rank, suit } = parseCard(code);
  const color = SUIT_COLORS[suit] || "#1a1919";
  const suitChar = SUIT_SYMBOLS[suit] || "";
  const offsetX = idx * 28;
  const top = isDealer ? 20 : 0;

  if (faceDown) {
    return (
      <div style={{
        width: 80, height: 115, borderRadius: 10, position: "absolute",
        left: offsetX, top,
        background: "linear-gradient(180deg, #1a1a1a, #282828)",
        boxShadow: "0 4px 12px rgba(0,0,0,.4), 0 2px 0 #111",
        border: "1px solid #333",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: `dealCard 0.4s ease-out ${idx * 0.15}s both`,
      }}>
        <div style={{ width: 50, height: 70, borderRadius: 6, border: "1px solid #444", background: "#111" }} />
      </div>
    );
  }

  return (
    <div style={{
      width: 80, height: 115, borderRadius: 10, position: "absolute",
      left: offsetX, top,
      background: "radial-gradient(circle at 30% 30%, #fff, #e8e8e8)",
      boxShadow: "0 4px 12px rgba(0,0,0,.3), inset 0 1px rgba(255,255,255,.5)",
      display: "flex", flexDirection: "column", padding: "6px 8px",
      animation: `dealCard 0.4s ease-out ${idx * 0.15}s both`,
    }}>
      <span style={{ fontSize: 16, fontWeight: 700, color, lineHeight: "1", fontFamily: G }}>{rank}</span>
      <span style={{ fontSize: 12, color, lineHeight: "1" }}>{suitChar}</span>
      <span style={{ fontSize: 32, color, position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", opacity: 0.15 }}>{suitChar}</span>
    </div>
  );
}

export default function BlackjackPage() {
  const [game, setGame] = useState<BlackjackGame | null>(null);
  const [bet, setBet] = useState("10.00");
  const [sidePairs, setSidePairs] = useState("0");
  const [side21, setSide21] = useState("0");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const status = game?.status;
  const isActive = status === "ACTIVE";
  const isWon = status === "WON";
  const isLost = status === "LOST";
  const isPush = status === "PUSH";

  const tableImg = !game ? TABLE_IDLE : isActive ? TABLE_ACTIVE : isWon ? TABLE_WIN : isLost ? TABLE_LOSE : TABLE_IDLE;

  const loadActive = useCallback(async () => {
    try {
      const g = await getActiveBlackjackGame("COINS");
      if (g) setGame(g);
    } catch { /* no active game */ }
  }, []);

  useEffect(() => { loadActive(); }, [loadActive]);

  const handlePlay = async () => {
    setErr(null); setLoading(true);
    try {
      const betAtomic = String(Math.round(parseFloat(bet) * 1e8));
      const pairsAtomic = parseFloat(sidePairs) > 0 ? String(Math.round(parseFloat(sidePairs) * 1e8)) : undefined;
      const plus3Atomic = parseFloat(side21) > 0 ? String(Math.round(parseFloat(side21) * 1e8)) : undefined;
      const g = await startBlackjackGame({ currency: "COINS", betAtomic, sideBetPairsAtomic: pairsAtomic, sideBet21Plus3Atomic: plus3Atomic });
      setGame(g);
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  };

  const handleAction = async (action: BlackjackAction) => {
    if (!game) return;
    setErr(null); setLoading(true);
    try {
      const g = await actBlackjack(game.gameId, action);
      setGame(g);
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  };

  const handleNewGame = () => { setGame(null); };

  const playerHand = game?.playerHands?.[game.activeHandIndex || 0];
  const dealerCards = game?.dealerVisibleCards || [];
  const dealerValue = game?.dealerRevealed ? (game.dealerCards || []).reduce((sum, c) => {
    const r = c.slice(0, -1);
    if (r === "A") return sum + 11;
    if (["K", "Q", "J"].includes(r)) return sum + 10;
    return sum + parseInt(r);
  }, 0) : "?";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, paddingBottom: 20 }}>
      {/* Table */}
      <div style={{ position: "relative", width: "100%", maxWidth: 800, aspectRatio: "988/682" }}>
        <img src={tableImg} alt="Blackjack table" style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 20 }} />

        {/* Dealer cards */}
        {game && dealerCards.length > 0 && (
          <div style={{ position: "absolute", top: "12%", left: "50%", transform: "translateX(-50%)" }}>
            <div style={{ position: "relative", height: 120, width: dealerCards.length * 28 + 80 }}>
              {dealerCards.map((c, i) => (
                <CardComponent key={i} code={c} idx={i} isDealer faceDown={!game.dealerRevealed && i === 1} />
              ))}
            </div>
            <div style={{ textAlign: "center", marginTop: 4 }}>
              <span style={{ background: "#000", color: "#fff", padding: "2px 10px", borderRadius: 8, fontSize: 14, fontWeight: 700, fontFamily: G }}>
                {typeof dealerValue === "number" ? dealerValue : "?"}
              </span>
            </div>
          </div>
        )}

        {/* Player cards */}
        {playerHand && (
          <div style={{ position: "absolute", bottom: "18%", left: "50%", transform: "translateX(-50%)" }}>
            <div style={{ position: "relative", height: 120, width: playerHand.cards.length * 28 + 80 }}>
              {playerHand.cards.map((c, i) => (
                <CardComponent key={i} code={c} idx={i} />
              ))}
            </div>
            <div style={{ textAlign: "center", marginTop: 4 }}>
              <span style={{ background: "#000", color: "#fff", padding: "2px 10px", borderRadius: 8, fontSize: 14, fontWeight: 700, fontFamily: G }}>
                {playerHand.value}
              </span>
            </div>
          </div>
        )}

        {/* Game result overlay */}
        {game && !isActive && (
          <div style={{ position: "absolute", top: "45%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center" }}>
            <span style={{
              fontSize: 28, fontWeight: 800, fontFamily: G, padding: "8px 24px", borderRadius: 12,
              color: "#fff",
              background: isWon ? "rgba(34,197,94,.85)" : isLost ? "rgba(239,68,68,.85)" : "rgba(255,255,255,.15)",
              textShadow: "0 2px 8px rgba(0,0,0,.5)",
            }}>
              {isWon ? "YOU WIN!" : isLost ? "BUST" : isPush ? "PUSH" : status}
            </span>
            {game.payoutAtomic && (
              <p style={{ color: "#55ff60", fontSize: 18, fontWeight: 700, marginTop: 8, fontFamily: G }}>+{fmtCoins(game.payoutAtomic)} COINS</p>
            )}
          </div>
        )}
      </div>

      {/* Betting controls / action bar */}
      <div style={{
        width: "100%", maxWidth: 800, borderRadius: 20, padding: "16px 24px",
        background: "linear-gradient(180deg, #161616, #0d0d0d)",
        boxShadow: "0 -5px 30px #090909",
        display: "flex", alignItems: "center", gap: 16,
      }}>
        {!game || !isActive ? (
          <>
            {/* Bet inputs */}
            <div style={{ display: "flex", gap: 12, flex: 1 }}>
              <div style={{ flex: 1 }}>
                <p style={{ color: "#828282", fontSize: 11, margin: "0 0 4px", fontFamily: G }}>Main bet (COINS)</p>
                <div style={{ display: "flex", alignItems: "center", background: "#090909", borderRadius: 10, padding: "0 12px", height: 40 }}>
                  <input value={bet} onChange={(e) => setBet(e.target.value)}
                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 14, fontFamily: G, fontWeight: 500 }} />
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: "#828282", fontSize: 11, margin: "0 0 4px", fontFamily: G }}>Pairs side bet (optional)</p>
                <div style={{ display: "flex", alignItems: "center", background: "#090909", borderRadius: 10, padding: "0 12px", height: 40 }}>
                  <input value={sidePairs} onChange={(e) => setSidePairs(e.target.value)}
                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 14, fontFamily: G, fontWeight: 500 }} />
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: "#828282", fontSize: 11, margin: "0 0 4px", fontFamily: G }}>21+3 side bet (optional)</p>
                <div style={{ display: "flex", alignItems: "center", background: "#090909", borderRadius: 10, padding: "0 12px", height: 40 }}>
                  <input value={side21} onChange={(e) => setSide21(e.target.value)}
                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 14, fontFamily: G, fontWeight: 500 }} />
                </div>
              </div>
            </div>

            {/* Play / New Game button */}
            <button onClick={game ? handleNewGame : handlePlay} disabled={loading}
              style={{
                height: 48, paddingLeft: 28, paddingRight: 28, borderRadius: 12, border: "none", cursor: "pointer",
                background: "linear-gradient(180deg, #ac2e30, #f75154)",
                boxShadow: "inset 0 1px 0 #f24f51, inset 0 -1px 0 #ff7476",
                color: "#fff", fontSize: 16, fontWeight: 600, fontFamily: G,
                display: "flex", alignItems: "center", gap: 8,
                opacity: loading ? 0.5 : 1,
              }}>
              {!game && <img src={PLAY_ICON} alt="" style={{ width: 20, height: 20 }} />}
              {loading ? "..." : game ? "New Game" : "Play"}
            </button>
            {game && !isActive && (
              <p style={{ color: "#828282", fontSize: 12, fontFamily: G, margin: 0 }}>Side bets are optional.</p>
            )}
          </>
        ) : (
          /* In-game action buttons */
          <div style={{ display: "flex", gap: 10, width: "100%" }}>
            <button onClick={() => handleAction("HIT")} disabled={loading}
              style={{ flex: 1, height: 48, borderRadius: 12, border: "none", cursor: "pointer", background: "#1a1a1a", boxShadow: "inset 0 1px 0 #252525, inset 0 -1px 0 #242424", color: "#fff", fontSize: 16, fontWeight: 600, fontFamily: G, opacity: loading ? 0.5 : 1 }}>
              Hit
            </button>
            <button onClick={() => handleAction("STAND")} disabled={loading}
              style={{ flex: 1, height: 48, borderRadius: 12, border: "none", cursor: "pointer", background: "linear-gradient(180deg, #ac2e30, #f75154)", boxShadow: "inset 0 1px 0 #f24f51, inset 0 -1px 0 #ff7476", color: "#fff", fontSize: 16, fontWeight: 600, fontFamily: G, opacity: loading ? 0.5 : 1 }}>
              Stand
            </button>
            {game.canSplit && (
              <button onClick={() => handleAction("SPLIT")} disabled={loading}
                style={{ flex: 1, height: 48, borderRadius: 12, border: "none", cursor: "pointer", background: "#1a1a1a", boxShadow: "inset 0 1px 0 #252525, inset 0 -1px 0 #242424", color: "#fff", fontSize: 16, fontWeight: 600, fontFamily: G, opacity: loading ? 0.5 : 1 }}>
                Split
              </button>
            )}
            <button onClick={() => handleAction("DOUBLE")} disabled={loading || (playerHand?.cards.length || 0) > 2}
              style={{ flex: 1, height: 48, borderRadius: 12, border: "none", cursor: "pointer", background: "#1a1a1a", boxShadow: "inset 0 1px 0 #252525, inset 0 -1px 0 #242424", color: "#fff", fontSize: 16, fontWeight: 600, fontFamily: G, opacity: loading || (playerHand?.cards.length || 0) > 2 ? 0.3 : 1 }}>
              Double
            </button>
            {game.canInsurance && (
              <button onClick={() => handleAction("INSURANCE")} disabled={loading}
                style={{ flex: 1, height: 48, borderRadius: 12, border: "none", cursor: "pointer", background: "#1a1a1a", boxShadow: "inset 0 1px 0 #252525, inset 0 -1px 0 #242424", color: "#828282", fontSize: 16, fontWeight: 600, fontFamily: G, opacity: loading ? 0.5 : 1 }}>
                Insurance
              </button>
            )}
          </div>
        )}
      </div>

      {err && <p style={{ color: "#f34950", fontSize: 12, fontFamily: G, margin: 0 }}>{err}</p>}
    </div>
  );
}
