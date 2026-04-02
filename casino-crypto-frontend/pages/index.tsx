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
    <div className="mx-auto w-full max-w-[1481px] font-sans">
      <div className="grid grid-cols-[62px_minmax(0,1fr)] gap-3">
        <aside className="rounded-[18px] bg-[#0d0d0d] py-2">
          <div className="space-y-1.5">
            {sideIcons.map((icon) => (
              <button
                key={icon}
                type="button"
                className="mx-auto flex h-[42px] w-[42px] items-center justify-center rounded-lg bg-[#161616] text-sm text-gray-400 shadow-[inset_0_1px_0_0_rgba(37,37,37,0.34),inset_0_-1px_0_0_rgba(36,36,36,0.39)]"
              >
                {icon}
              </button>
            ))}
          </div>
        </aside>

        <div className="space-y-4">
          <section className="grid grid-cols-[981px_480px] gap-5 max-[1600px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="flex h-[328px] items-center justify-center rounded-2xl bg-[#1a1a1a]">
              <span className="text-[42px] font-medium italic leading-[43px] text-white/20">BANNER 1</span>
            </div>
            <div className="flex h-[328px] items-center justify-center rounded-2xl bg-[#1a1a1a]">
              <span className="text-[42px] font-medium italic leading-[43px] text-white/20">BANNER 2</span>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-2xl text-red-400">✦</span>
              <p className="text-2xl font-bold text-white">Games</p>
            </div>
            <div className="grid grid-cols-5 gap-5 max-[1600px]:grid-cols-3">
              {gameCards.map((game) => (
                <Link
                  key={game.href}
                  href={game.href}
                  className={`h-[347px] rounded-2xl border border-[#2a1d23] bg-gradient-to-b ${game.accent} p-5 transition hover:-translate-y-0.5`}
                >
                  <p className="text-[20px] font-bold uppercase leading-5 text-white">{game.title}</p>
                  <div className="mt-10 flex h-[220px] items-end justify-center text-8xl">{game.icon}</div>
                </Link>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl text-red-400">✦</span>
                <p className="text-2xl font-bold text-white">Highlights</p>
              </div>
              <button className="rounded-xl bg-[#1a1a1a] px-9 py-4 text-[18px] font-medium text-white shadow-[inset_0_1px_0_0_#252525,inset_0_-1px_0_0_#242424]">
                View All
              </button>
            </div>

            <div className="mb-2 flex items-center gap-1 rounded-[18px] bg-[#060606] p-1.5">
              <button className="rounded-xl bg-[#1a1a1a] px-9 py-4 text-[18px] font-medium text-white shadow-[inset_0_1px_0_0_#252525,inset_0_-1px_0_0_#242424]">
                All Games
              </button>
              <button className="rounded-xl px-9 py-4 text-[18px] font-medium text-white">Big wins</button>
              <button className="rounded-xl px-9 py-4 text-[18px] font-medium text-white">My Games</button>
            </div>

            <div className="overflow-hidden rounded-[18px] border border-[#1b1b1b]">
              <table className="min-w-full text-sm">
                <thead className="bg-gradient-to-b from-[#282828] to-[#1a1a1a] text-[14px] text-[#828282]">
                  <tr>
                    <th className="px-4 py-5 text-left font-medium">Game</th>
                    <th className="px-4 py-5 text-left font-medium">Player</th>
                    <th className="px-4 py-5 text-left font-medium">Amount</th>
                    <th className="px-4 py-5 text-left font-medium">Multi</th>
                    <th className="px-4 py-5 text-left font-medium">Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {highlights.map((row, idx) => (
                    <tr key={`${row.userLabel}-${idx}`} className="border-t border-[#161616] bg-[#0d0d0d] text-gray-300">
                      <td className="px-4 py-5 text-[#b2b2b2]">{row.game}</td>
                      <td className="px-4 py-5 font-medium text-white">{row.userLabel}</td>
                      <td className="px-4 py-5 text-[#ffc353]">{row.amount}</td>
                      <td className="px-4 py-5 text-[#828282]">{row.multi}</td>
                      <td className="px-4 py-5 text-[#ffc353]">{row.payout}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <footer className="rounded-[18px] bg-[#090909] px-5 py-8">
            <div className="grid grid-cols-[302px_minmax(0,1fr)] gap-14">
              <div>
                <p className="text-[42px] font-medium italic leading-[43px] text-white">REDWATER</p>
                <p className="mt-3 text-[16px] font-medium leading-[26px] text-[#828282]">© All rights reserved 2026</p>
                <p className="mt-1 text-[16px] font-medium leading-[26px] text-[#828282]">
                  Upgrader is operated by Innospace LTD,<br />
                  Organization number 646564, Voukourestiou, 25<br />
                  Neptune House, 1st Floor, Office 11, Zakaki, 3045,<br />
                  Limassol, Cyprus.
                </p>
                <div className="mt-3 flex gap-14 text-[16px] leading-[26px]">
                  <div>
                    <p className="text-[#828282]">Support:</p>
                    <p className="font-medium text-white">support@redwater.gg</p>
                  </div>
                  <div>
                    <p className="text-[#828282]">Partners:</p>
                    <p className="font-medium text-white">partners@redwater.gg</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-14">
                <div>
                  <p className="text-[18px] font-medium text-white">Games</p>
                  <ul className="mt-4 space-y-4 text-[18px] font-medium text-[#828282]">
                    <li>Cases</li>
                    <li>Case Battles</li>
                    <li>Roulette</li>
                    <li>Mines</li>
                    <li>BlackJack</li>
                  </ul>
                </div>
                <div>
                  <p className="text-[18px] font-medium text-white">Platform</p>
                  <ul className="mt-4 space-y-4 text-[18px] font-medium text-[#828282]">
                    <li>Rewards</li>
                    <li>Affiliates</li>
                    <li>Blog</li>
                    <li>Support</li>
                    <li>FAQ</li>
                    <li>Partnerships</li>
                  </ul>
                </div>
                <div>
                  <p className="text-[18px] font-medium text-white">About us</p>
                  <ul className="mt-4 space-y-4 text-[18px] font-medium text-[#828282]">
                    <li>Tearms of Service</li>
                    <li>Privacy Policy</li>
                    <li>AML Policy</li>
                    <li>Cookies Policy</li>
                    <li>Self-Exclusion</li>
                    <li>Fairness</li>
                  </ul>
                </div>
                <div>
                  <p className="text-[18px] font-medium text-white">Community</p>
                  <ul className="mt-4 space-y-4 text-[18px] font-medium text-[#828282]">
                    <li>Twitter</li>
                    <li>Discord</li>
                    <li>Telegram</li>
                    <li>Kick</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-5">
                <span className="inline-flex h-[52px] w-[52px] items-center justify-center rounded-full border-2 border-[#f34950] text-[16px] text-[#f34950]">
                  18+
                </span>
                <p className="max-w-[278px] text-[16px] leading-[26px] text-[#828282]">
                  By accessing this site, you confirm that you are over 18 years old.
                </p>
              </div>
              <div className="flex gap-2">
                {["VISA", "MC", "PP", "GPay", "Apple", "BTC", "ETH", "USDT", "SOL", "Alipay"].map((x) => (
                  <span key={x} className="rounded bg-[#111623] px-2 py-1 text-[10px] text-gray-500">
                    {x}
                  </span>
                ))}
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
