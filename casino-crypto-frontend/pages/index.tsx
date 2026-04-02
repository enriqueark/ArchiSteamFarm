import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getLeaderboard, type LeaderboardEntry } from "@/lib/api";

const gameCards: Array<{ title: string; href: string; icon: string; accent: string }> = [
  { title: "CASES", href: "/cases", icon: "🧰", accent: "from-[#2a0f12] to-[#6f1c24]" },
  { title: "CASE BATTLE", href: "/battles", icon: "⚔️", accent: "from-[#240f13] to-[#812635]" },
  { title: "ROULETTE", href: "/roulette", icon: "🎡", accent: "from-[#1f1114] to-[#74252f]" },
  { title: "MINES", href: "/mines", icon: "💣", accent: "from-[#211216] to-[#8a2f3a]" },
  { title: "BLACKJACK", href: "/blackjack", icon: "🃏", accent: "from-[#220f12] to-[#7b2530]" }
];

const sideIcons = ["❤", "⚔", "◎", "★", "21"];

const toCoins = (atomic: string): string => {
  const value = Number(atomic);
  if (!Number.isFinite(value)) {
    return "0.00";
  }
  return (value / 1e8).toFixed(2);
};

export default function HomePage() {
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    getLeaderboard(7)
      .then((data) => {
        if (!cancelled) {
          setRows(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const highlights = useMemo(() => {
    if (rows.length) {
      return rows.map((row) => ({
        game: "Roulette",
        userLabel: row.userLabel,
        amount: "1.00",
        multi: "0.00x",
        payout: toCoins(row.balanceAtomic)
      }));
    }
    return Array.from({ length: 7 }).map((_, idx) => ({
      game: "Roulette",
      userLabel: idx % 2 ? "Jake" : "WildHub",
      amount: "1.00",
      multi: "0.00x",
      payout: "0.00"
    }));
  }, [rows]);

  return (
    <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-3">
      <aside className="rounded-md border border-[#171c28] bg-[#0b0f17] py-3">
        <div className="space-y-2">
          {sideIcons.map((icon) => (
            <button
              key={icon}
              type="button"
              className="mx-auto flex h-7 w-7 items-center justify-center rounded text-[11px] text-gray-400 transition hover:bg-white/5 hover:text-white"
            >
              {icon}
            </button>
          ))}
        </div>
      </aside>

      <div className="space-y-3">
        <section className="grid grid-cols-12 gap-2">
          <div className="col-span-8 flex h-[150px] items-center justify-center rounded-lg border border-[#1a2030] bg-[#12161f]">
            <span className="text-4xl font-extrabold italic tracking-wide text-white/20">BANNER 1</span>
          </div>
          <div className="col-span-4 flex h-[150px] items-center justify-center rounded-lg border border-[#1a2030] bg-[#12161f]">
            <span className="text-4xl font-extrabold italic tracking-wide text-white/20">BANNER 2</span>
          </div>
        </section>

        <section>
          <p className="mb-2 text-sm font-semibold text-white">🎮 Games</p>
          <div className="grid grid-cols-5 gap-2">
            {gameCards.map((game) => (
              <Link
                key={game.href}
                href={game.href}
                className={`h-[158px] rounded-lg border border-[#2a1d23] bg-gradient-to-b ${game.accent} p-3 transition hover:-translate-y-0.5`}
              >
                <p className="text-xs font-bold tracking-wide text-white">{game.title}</p>
                <div className="mt-6 flex h-[98px] items-end justify-center text-6xl">{game.icon}</div>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-[#171c28] bg-[#090d14] p-3">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-lg font-semibold text-white">✨ Highlights</p>
              <div className="mt-2 flex gap-2 text-xs">
                <button className="rounded-md bg-[#1a202d] px-3 py-1.5 text-white">All Games</button>
                <button className="rounded-md bg-[#121722] px-3 py-1.5 text-gray-400">Big wins</button>
                <button className="rounded-md bg-[#121722] px-3 py-1.5 text-gray-400">My Games</button>
              </div>
            </div>
            <button className="rounded-md bg-[#1a202d] px-3 py-1.5 text-xs font-semibold text-gray-300">View All</button>
          </div>

          <div className="overflow-hidden rounded-lg border border-[#171c28]">
            <table className="min-w-full text-sm">
              <thead className="bg-[#0d1119] text-[11px] text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Game</th>
                  <th className="px-4 py-2 text-left">Player</th>
                  <th className="px-4 py-2 text-left">Amount</th>
                  <th className="px-4 py-2 text-left">Multi</th>
                  <th className="px-4 py-2 text-left">Payout</th>
                </tr>
              </thead>
              <tbody>
                {highlights.map((row, idx) => (
                  <tr key={`${row.userLabel}-${idx}`} className="border-t border-[#161b28] bg-[#0a0f17] text-gray-300">
                    <td className="px-4 py-3 text-gray-400">{row.game}</td>
                    <td className="px-4 py-3 font-semibold">{row.userLabel}</td>
                    <td className="px-4 py-3 text-amber-300">{row.amount}</td>
                    <td className="px-4 py-3 text-gray-500">{row.multi}</td>
                    <td className="px-4 py-3 text-amber-300">{row.payout}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="rounded-lg border border-[#171c28] bg-[#080b12] px-4 py-5">
          <div className="grid grid-cols-5 gap-6">
            <div>
              <p className="text-3xl font-black italic text-white">REDWATER</p>
              <p className="mt-2 text-xs text-gray-500">© All rights reserved 2026</p>
              <p className="mt-2 text-xs text-gray-600">support: support@redwater.gg</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Games</p>
              <ul className="mt-2 space-y-1 text-sm text-gray-500">
                <li>Cases</li>
                <li>Case Battles</li>
                <li>Roulette</li>
                <li>Mines</li>
                <li>BlackJack</li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Platform</p>
              <ul className="mt-2 space-y-1 text-sm text-gray-500">
                <li>Rewards</li>
                <li>Affiliates</li>
                <li>Blog</li>
                <li>Support</li>
                <li>FAQ</li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">About us</p>
              <ul className="mt-2 space-y-1 text-sm text-gray-500">
                <li>Terms of Service</li>
                <li>Privacy Policy</li>
                <li>AML Policy</li>
                <li>Cookies Policy</li>
                <li>Fairness</li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Community</p>
              <ul className="mt-2 space-y-1 text-sm text-gray-500">
                <li>Twitter</li>
                <li>Discord</li>
                <li>Telegram</li>
                <li>Kick</li>
              </ul>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            {["VISA", "MC", "GPay", "Apple", "USDT", "BTC", "ETH"].map((x) => (
              <span key={x} className="rounded bg-[#111623] px-2 py-1 text-[10px] text-gray-500">
                {x}
              </span>
            ))}
          </div>
        </footer>
      </div>
    </div>
  );
}
