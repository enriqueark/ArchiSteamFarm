import Link from "next/link";
import { useEffect, useState } from "react";
import { getMyRouletteBets, type RouletteBet } from "@/lib/api";
import CoinAmount from "@/components/CoinAmount";

const games = [
  { name: "CASES", href: "/cases", img: "/assets/c92374a7485d20ac9bbef2d35ed1a789.png", icon: "/assets/098fe17d7ecd701c12a38a0cadfb52c7.svg" },
  { name: "CASE BATTLE", href: "/case-battles", img: "/assets/9f3dc7144a620b11022014239169d46e.png", icon: "/assets/a3e58527c3e7370a1e8d3424ef21f14e.svg" },
  { name: "ROULETTE", href: "/roulette", img: "/assets/b8e5b82a90d613d81dd652412e8e23ee.png", icon: "/assets/30f1deaab44de7043abb1842bd019412.svg" },
  { name: "MINES", href: "/mines", img: "/assets/9d98d1f5815402cf67601802a236e1b3.png", icon: "/assets/a52450c41c59fc6f0f63e0a9e8b9be5b.svg" },
  { name: "BLACKJACK", href: "/blackjack", img: "/assets/cea3c3db4ef626ba499a275c20d4030a.png", icon: "/assets/d8347e0a14786c0b7e4e5b5719203353.svg" },
];


function formatAtomic(val: string, decimals = 8): string {
  return (Number(val) / Math.pow(10, decimals)).toFixed(2);
}

export default function HomePage() {
  const [bets, setBets] = useState<RouletteBet[]>([]);
  const [tab, setTab] = useState<"all" | "wins" | "mine">("mine");

  useEffect(() => {
    getMyRouletteBets(50).then(setBets).catch(() => {});
  }, []);

  const filteredBets = tab === "wins" ? bets.filter((b) => b.status === "WON") : bets;

  return (
    <div className="space-y-6">
      {/* Banners */}
      <div className="grid grid-cols-2 gap-4">
        {[1, 2].map((n) => (
          <div
            key={n}
            className="h-[180px] rounded-card flex items-center justify-center"
            style={{ background: "linear-gradient(180deg, #161616 0%, #0d0d0d 100%)" }}
          >
            <span className="text-2xl font-bold text-[#333]">BANNER {n}</span>
          </div>
        ))}
      </div>

      {/* Games */}
      <div>
        <div className="flex items-center gap-2.5 mb-4">
          <img src="/assets/63c8c686837122667ee0f137787e2d7c.svg" alt="" className="w-6 h-6" />
          <h2 className="text-xl font-bold text-white">Games</h2>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {games.map((g) => (
            <Link
              key={g.name}
              href={g.href}
              className="group relative rounded-card overflow-hidden"
              style={{ background: "linear-gradient(180deg, #161616 0%, #0d0d0d 100%)" }}
            >
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] h-[200px] rounded-full opacity-30 pointer-events-none"
                style={{ background: "radial-gradient(circle, #f75154 0%, transparent 70%)", filter: "blur(60px)" }}
              />
              <div className="relative h-[280px] flex items-center justify-center p-4">
                <img
                  src={g.img}
                  alt={g.name}
                  className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300"
                />
              </div>
              <div className="relative flex items-center gap-2 px-4 py-3 bg-[#0d0d0d]/80">
                <img src={g.icon} alt="" className="w-5 h-5" />
                <span className="text-sm font-medium text-white">{g.name}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Highlights — real bet data */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <img src="/assets/4e95822b3466acf681a95bd6c857747a.svg" alt="" className="w-6 h-6" />
            <h2 className="text-xl font-bold text-white">Highlights</h2>
          </div>
          <Link href="/roulette" className="text-sm text-muted cursor-pointer hover:text-white transition-colors">
            View All
          </Link>
        </div>

        <div className="flex gap-2 mb-4">
          {([["all", "All Games"], ["wins", "Big wins"], ["mine", "My Games"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`h-[34px] rounded-[10px] px-4 text-[12px] font-medium leading-[12px] transition-all ${
                tab === key
                  ? "text-white border border-[#2f3640] bg-gradient-to-b from-[#1a1a1a] to-[#111111] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_-1px_0_rgba(0,0,0,0.35)]"
                  : "text-[#7f7f7f] border border-transparent bg-transparent hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="rounded-card overflow-hidden" style={{ background: "linear-gradient(180deg, #161616 0%, #0d0d0d 100%)" }}>
          <div className="grid grid-cols-5 px-5 py-3 text-xs font-medium text-muted border-b border-[#1a1a1a]">
            <span>Game</span>
            <span>Type</span>
            <span>Amount</span>
            <span>Status</span>
            <span>Payout</span>
          </div>
          {filteredBets.length === 0 ? (
            <div className="px-5 py-8 text-center text-muted text-sm">
              {bets.length === 0 ? "No bets yet. Play Roulette or Mines to see your history!" : "No matching bets."}
            </div>
          ) : (
            filteredBets.slice(0, 15).map((b, i) => (
              <div key={b.id || i} className="grid grid-cols-5 items-center px-5 py-3 border-b border-[#111] last:border-b-0 hover:bg-[#1a1a1a]/30 transition-colors">
                <div className="flex items-center gap-2.5">
                  <span className="w-[3px] h-5 rounded-r bg-accent-red" />
                  <span className="text-sm text-white">Roulette</span>
                </div>
                <span className="text-sm text-white">{b.betType}</span>
                <CoinAmount
                  amount={formatAtomic(b.stakeAtomic)}
                  iconSize={16}
                  textClassName="text-sm text-white"
                />
                <span className={`text-sm font-medium ${
                  b.status === "WON" ? "text-accent-green" : b.status === "LOST" ? "text-red-400" : "text-muted"
                }`}>
                  {b.status}
                </span>
                <CoinAmount
                  amount={b.payoutAtomic ? formatAtomic(b.payoutAtomic) : "0.00"}
                  iconSize={16}
                  textClassName={`text-sm ${b.status === "WON" ? "text-accent-green" : "text-white"}`}
                />
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
}
