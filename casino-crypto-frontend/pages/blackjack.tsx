import { useEffect, useMemo, useState } from "react";
import Button from "@/components/Button";
import Card from "@/components/Card";
import Input from "@/components/Input";
import { actBlackjack, getActiveBlackjackGame, startBlackjackGame, type BlackjackGame } from "@/lib/api";
import { useAuthUI } from "@/lib/auth-ui";
import { useToast } from "@/lib/toast";

const INTERNAL_GAME_CURRENCY = "USDT";
const COIN_DECIMALS = 8;
const MAX_BET_COINS = 5000;

const toAtomicString = (coinsRaw: string): string => {
  const value = Number(coinsRaw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Bet must be a positive COINS value");
  }
  if (value > MAX_BET_COINS) {
    throw new Error(`Maximum bet is ${MAX_BET_COINS} COINS`);
  }
  return String(Math.round(value * 10 ** COIN_DECIMALS));
};

const fromAtomic = (atomic: string | null | undefined): string => {
  if (!atomic) {
    return "0.00";
  }
  const value = Number(atomic);
  if (!Number.isFinite(value)) {
    return "0.00";
  }
  return (value / 10 ** COIN_DECIMALS).toFixed(2);
};

const toOptionalAtomicString = (coinsRaw: string): string | undefined => {
  const cleaned = coinsRaw.trim();
  if (!cleaned) {
    return undefined;
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Side bet must be 0 or more");
  }
  if (value === 0) {
    return undefined;
  }
  if (value > MAX_BET_COINS) {
    throw new Error(`Maximum side bet is ${MAX_BET_COINS} COINS`);
  }
  return String(Math.round(value * 10 ** COIN_DECIMALS));
};

const cardSuit = (card: string): "S" | "H" | "D" | "C" => {
  const suit = card.slice(-1);
  return suit === "H" || suit === "D" || suit === "C" ? suit : "S";
};

const cardRank = (card: string): string => card.slice(0, -1);

const suitGlyph = (suit: "S" | "H" | "D" | "C"): string => {
  if (suit === "H") return "♥";
  if (suit === "D") return "♦";
  if (suit === "C") return "♣";
  return "♠";
};

const suitColorClass = (suit: "S" | "H" | "D" | "C"): string =>
  suit === "H" || suit === "D" ? "text-red-500" : "text-gray-100";

const Chip = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <div
    className={`blackjack-chip blackjack-chip-bounce rounded-full px-3 py-2 text-xs font-semibold shadow-lg ${color}`}
    title={`${label}: ${value} COINS`}
  >
    <div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div>
    <div>{value}</div>
  </div>
);

const PlayingCard = ({
  card,
  hidden,
  delayMs = 0
}: {
  card?: string;
  hidden?: boolean;
  delayMs?: number;
}) => {
  if (hidden) {
    return (
      <div
        className="blackjack-card blackjack-card-deal h-28 w-20 rounded-lg border border-red-700/70 bg-gradient-to-br from-red-900 to-red-600 p-2 shadow-lg"
        style={{ animationDelay: `${delayMs}ms` }}
      >
        <div className="h-full w-full rounded border border-white/20 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.2),transparent_45%)]" />
      </div>
    );
  }

  if (!card) {
    return (
      <div className="h-28 w-20 rounded-lg border border-gray-700 bg-gray-900/40 p-2 text-xs text-gray-500 flex items-center justify-center">
        --
      </div>
    );
  }

  const suit = cardSuit(card);
  return (
    <div
      className="blackjack-card blackjack-card-deal h-28 w-20 rounded-lg border border-gray-300 bg-white p-2 shadow-lg"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className={`text-sm font-bold ${suitColorClass(suit)}`}>{cardRank(card)}</div>
      <div className={`mt-4 text-center text-2xl ${suitColorClass(suit)}`}>{suitGlyph(suit)}</div>
      <div className={`text-right text-sm font-bold ${suitColorClass(suit)}`}>{cardRank(card)}</div>
    </div>
  );
};

export default function BlackjackPage() {
  const { authed, openAuth } = useAuthUI();
  const { showError, showSuccess } = useToast();
  const [betCoins, setBetCoins] = useState("10.00");
  const [pairsBetCoins, setPairsBetCoins] = useState("0");
  const [plus3BetCoins, setPlus3BetCoins] = useState("0");
  const [loading, setLoading] = useState(false);
  const [game, setGame] = useState<BlackjackGame | null>(null);
  const [dealSeed, setDealSeed] = useState(0);
  const [winPulse, setWinPulse] = useState(false);

  useEffect(() => {
    if (!authed) {
      setGame(null);
      return;
    }
    getActiveBlackjackGame().then((active) => setGame(active)).catch(() => {});
  }, [authed]);

  const dealerCardsDisplay = useMemo(() => game?.dealerVisibleCards ?? [], [game?.dealerVisibleCards]);
  const activeHand = game ? game.playerHands[game.activeHandIndex] : null;
  const canAct = !!game && game.status === "ACTIVE";

  const startGame = async () => {
    if (!authed) {
      openAuth("register");
      showError("Create an account to play Blackjack.");
      return;
    }
    setLoading(true);
    try {
      const betAtomic = toAtomicString(betCoins);
      const pairsAtomic = toOptionalAtomicString(pairsBetCoins);
      const plus3Atomic = toOptionalAtomicString(plus3BetCoins);
      const created = await startBlackjackGame({
        currency: INTERNAL_GAME_CURRENCY,
        betAtomic,
        sideBetPairsAtomic: pairsAtomic,
        sideBet21Plus3Atomic: plus3Atomic
      });
      setDealSeed(Date.now());
      setGame(created);
      showSuccess("Blackjack game started.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Unable to start blackjack");
    } finally {
      setLoading(false);
    }
  };

  const doAction = async (action: "HIT" | "STAND" | "DOUBLE" | "SPLIT" | "INSURANCE") => {
    if (!game) {
      return;
    }
    setLoading(true);
    try {
      const next = await actBlackjack(game.gameId, action);
      setDealSeed(Date.now());
      setGame(next);
      if (next.status !== "ACTIVE") {
        const payoutAtomic = next.payoutAtomic ? Number(next.payoutAtomic) : 0;
        if (Number.isFinite(payoutAtomic) && payoutAtomic > 0) {
          setWinPulse(true);
          setTimeout(() => setWinPulse(false), 900);
          showSuccess(`You received ${fromAtomic(next.payoutAtomic)} COINS`);
        } else {
          showError("Hand finished with no payout.");
        }
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : "Blackjack action failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Blackjack</h1>
      <p className="text-xs text-gray-400">
        Dealer stands on 17+, hits on 16 or less. Max bet per hand: {MAX_BET_COINS} COINS.
      </p>

      {!game || game.status !== "ACTIVE" ? (
        <Card title="Start new hand">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Main bet (COINS)" value={betCoins} onChange={(e) => setBetCoins(e.target.value)} />
            <Input
              label="Pairs side bet (optional)"
              value={pairsBetCoins}
              onChange={(e) => setPairsBetCoins(e.target.value)}
              placeholder="0"
            />
            <Input
              label="21+3 side bet (optional)"
              value={plus3BetCoins}
              onChange={(e) => setPlus3BetCoins(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => void startGame()} disabled={loading}>
              {loading ? "Starting..." : "Deal"}
            </Button>
            <span className="text-xs text-gray-400">Side bets are optional. You can play with only the main bet.</span>
          </div>
        </Card>
      ) : null}

      {game ? (
        <div className="grid grid-cols-1 gap-4">
          <Card title="Blackjack table" className={`blackjack-table overflow-hidden ${winPulse ? "blackjack-win-pulse" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <Chip label="Main" value={fromAtomic(game.mainBetAtomic)} color="border border-amber-300/30 bg-amber-500/20 text-amber-100" />
                <Chip
                  label="Pairs"
                  value={fromAtomic(game.sideBetPairsAtomic)}
                  color="border border-sky-300/30 bg-sky-500/20 text-sky-100"
                />
                <Chip
                  label="21+3"
                  value={fromAtomic(game.sideBet21Plus3Atomic)}
                  color="border border-fuchsia-300/30 bg-fuchsia-500/20 text-fuchsia-100"
                />
                <Chip
                  label="Insurance"
                  value={fromAtomic(game.insuranceBetAtomic)}
                  color="border border-emerald-300/30 bg-emerald-500/20 text-emerald-100"
                />
              </div>
              <div className="text-xs text-gray-300">
                Status: <span className="font-semibold text-white">{game.status}</span>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="mb-2 text-xs uppercase tracking-wider text-gray-300">Dealer</div>
              <div className="flex gap-3 flex-wrap">
                {dealerCardsDisplay.map((card, idx) => (
                  <PlayingCard key={`${dealSeed}-dealer-${card}-${idx}`} card={card} delayMs={idx * 120} />
                ))}
                {!game.dealerRevealed ? (
                  <PlayingCard hidden delayMs={dealerCardsDisplay.length * 120} />
                ) : null}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {game.playerHands.map((hand, handIndex) => (
                <div
                  key={`hand-${handIndex}`}
                  className={`rounded-xl border p-3 ${
                    handIndex === game.activeHandIndex ? "border-red-400/70 bg-red-900/20" : "border-white/10 bg-black/20"
                  }`}
                >
                  <div className="mb-2 text-xs text-gray-300">
                    Hand {handIndex + 1} · Stake {fromAtomic(hand.stakeAtomic)} · Value {hand.value}
                    {hand.blackjack ? " · BLACKJACK" : ""}
                    {hand.busted ? " · BUST" : ""}
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    {hand.cards.map((card, idx) => (
                      <PlayingCard key={`${dealSeed}-player-${handIndex}-${card}-${idx}`} card={card} delayMs={idx * 120} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Provably Fair">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
              <div className="rounded border border-gray-800 bg-gray-900/60 p-2">
                <div className="text-gray-400">Server Seed Hash</div>
                <div className="font-mono break-all">{game.provablyFair?.serverSeedHash ?? "-"}</div>
              </div>
              <div className="rounded border border-gray-800 bg-gray-900/60 p-2">
                <div className="text-gray-400">Client Seed</div>
                <div className="font-mono break-all">{game.provablyFair?.clientSeed ?? "-"}</div>
              </div>
              <div className="rounded border border-gray-800 bg-gray-900/60 p-2">
                <div className="text-gray-400">Nonce</div>
                <div className="font-mono">{game.provablyFair?.nonce ?? 0}</div>
              </div>
            </div>
            <div className="mt-2 text-xs text-gray-400">
              Side-bet paytable: Pairs x{game.paytable?.pairsMultiplier ?? 11}, 21+3 x{game.paytable?.plus3Multiplier ?? 9}
            </div>
          </Card>
        </div>
      ) : null}

      {canAct && activeHand ? (
        <Card title="Actions">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void doAction("HIT")} disabled={loading || activeHand.doubled}>
              HIT
            </Button>
            <Button onClick={() => void doAction("STAND")} disabled={loading}>
              STAND
            </Button>
            <Button onClick={() => void doAction("DOUBLE")} disabled={loading || activeHand.cards.length !== 2 || activeHand.doubled}>
              DOUBLE
            </Button>
            <Button onClick={() => void doAction("SPLIT")} disabled={loading || !game.canSplit}>
              SPLIT
            </Button>
            <Button onClick={() => void doAction("INSURANCE")} disabled={loading || !game.canInsurance || !!game.insuranceBetAtomic}>
              INSURANCE
            </Button>
          </div>
        </Card>
      ) : null}

      {game && game.status !== "ACTIVE" ? (
        <Card title="Hand result">
          <div className="flex items-center gap-2 text-[11px] text-gray-400 mb-2">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 blackjack-win-pulse" />
            <span>Round settled</span>
          </div>
          <p className="text-sm">
            Status: <span className="font-semibold">{game.status}</span>
          </p>
          <p className="text-sm">Payout: {fromAtomic(game.payoutAtomic)} COINS</p>
        </Card>
      ) : null}
    </div>
  );
}
