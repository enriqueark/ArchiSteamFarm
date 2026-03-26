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

export default function BlackjackPage() {
  const { authed, openAuth } = useAuthUI();
  const { showError, showSuccess } = useToast();
  const [betCoins, setBetCoins] = useState("10.00");
  const [pairsBetCoins, setPairsBetCoins] = useState("0");
  const [plus3BetCoins, setPlus3BetCoins] = useState("0");
  const [loading, setLoading] = useState(false);
  const [game, setGame] = useState<BlackjackGame | null>(null);

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
      const pairsAtomic = toAtomicString(String(Math.max(0, Number(pairsBetCoins) || 0)));
      const plus3Atomic = toAtomicString(String(Math.max(0, Number(plus3BetCoins) || 0)));
      const created = await startBlackjackGame({
        currency: INTERNAL_GAME_CURRENCY,
        betAtomic,
        sideBetPairsAtomic: pairsAtomic === "0" ? undefined : pairsAtomic,
        sideBet21Plus3Atomic: plus3Atomic === "0" ? undefined : plus3Atomic
      });
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
      setGame(next);
      if (next.status !== "ACTIVE") {
        const payoutAtomic = next.payoutAtomic ? Number(next.payoutAtomic) : 0;
        if (Number.isFinite(payoutAtomic) && payoutAtomic > 0) {
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
            <Input label="Pairs side bet (COINS)" value={pairsBetCoins} onChange={(e) => setPairsBetCoins(e.target.value)} />
            <Input label="21+3 side bet (COINS)" value={plus3BetCoins} onChange={(e) => setPlus3BetCoins(e.target.value)} />
          </div>
          <div className="mt-3">
            <Button onClick={() => void startGame()} disabled={loading}>
              {loading ? "Starting..." : "Deal"}
            </Button>
          </div>
        </Card>
      ) : null}

      {game ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Dealer">
            <div className="flex gap-2 flex-wrap">
              {dealerCardsDisplay.map((card, idx) => (
                <span key={`${card}-${idx}`} className="rounded bg-gray-800 px-2 py-1 text-sm font-mono">
                  {card}
                </span>
              ))}
              {!game.dealerRevealed ? (
                <span className="rounded bg-gray-900 border border-gray-700 px-2 py-1 text-sm font-mono">??</span>
              ) : null}
            </div>
          </Card>

          <Card title={`Player hands · Active #${game.activeHandIndex + 1}`}>
            <div className="space-y-2">
              {game.playerHands.map((hand, handIndex) => (
                <div
                  key={`hand-${handIndex}`}
                  className={`rounded border px-3 py-2 ${
                    handIndex === game.activeHandIndex ? "border-red-500 bg-red-950/20" : "border-gray-800 bg-gray-900/50"
                  }`}
                >
                  <div className="text-xs text-gray-400 mb-1">
                    Hand {handIndex + 1} · Stake {fromAtomic(hand.stakeAtomic)} · Value {hand.value}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {hand.cards.map((card, idx) => (
                      <span key={`${card}-${idx}`} className="rounded bg-gray-800 px-2 py-1 text-sm font-mono">
                        {card}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
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
          <p className="text-sm">
            Status: <span className="font-semibold">{game.status}</span>
          </p>
          <p className="text-sm">Payout: {fromAtomic(game.payoutAtomic)} COINS</p>
        </Card>
      ) : null}
    </div>
  );
}
