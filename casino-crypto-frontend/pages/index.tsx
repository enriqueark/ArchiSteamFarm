import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Button from "@/components/Button";
import Card from "@/components/Card";
import { getLeaderboard, type LeaderboardEntry } from "@/lib/api";
import { useAuthUI } from "@/lib/auth-ui";

const gameCards: Array<{ title: string; href: string; accent: string; icon: string }> = [
  { title: "Cases", href: "/cases", accent: "from-red-700 to-red-950", icon: "🗃️" },
  { title: "Case Battles", href: "/battles", accent: "from-rose-700 to-rose-950", icon: "⚔️" },
  { title: "Roulette", href: "/roulette", accent: "from-red-600 to-zinc-900", icon: "🎡" },
  { title: "Mines", href: "/mines", accent: "from-red-500 to-zinc-900", icon: "💣" },
  { title: "Blackjack", href: "/blackjack", accent: "from-red-800 to-zinc-950", icon: "🂡" }
];

const toCoins = (atomic: string): string => {
  const value = Number(atomic);
  if (!Number.isFinite(value)) {
    return "0.00";
  }
  return (value / 1e8).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function HomePage() {
  const { authed, openAuth } = useAuthUI();
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLeaderboard(8)
      .then((data) => {
        if (!cancelled) {
          setRows(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const highlights = useMemo(() => rows.slice(0, 6), [rows]);

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2 border-red-500/25 bg-gradient-to-r from-zinc-900 via-zinc-900 to-red-950/50">
          <div className="flex h-full min-h-[120px] items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-red-300">Banner 1</p>
              <h1 className="mt-2 text-2xl font-extrabold text-white">Redwater Casino Experience</h1>
              <p className="mt-1 text-sm text-zinc-300">Premium UI concept, provably fair games and social features.</p>
            </div>
            <div className="h-14 w-14 rounded-full bg-red-500/20 text-3xl flex items-center justify-center">♦</div>
          </div>
        </Card>
        <Card className="border-red-500/25 bg-gradient-to-br from-zinc-900 to-red-950/40">
          <div className="flex h-full min-h-[120px] flex-col justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-red-300">Banner 2</p>
              <p className="mt-2 text-sm text-zinc-300">Join rain every hour and track your progression leaderboard.</p>
            </div>
            {authed ? (
              <Link href="/leaderboard" className="mt-2 text-sm font-semibold text-red-300 hover:text-red-200">
                Open leaderboard →
              </Link>
            ) : (
              <Button
                className="mt-2 w-full bg-red-600 hover:bg-red-500"
                onClick={() => {
                  openAuth("login");
                }}
              >
                Sign in
              </Button>
            )}
          </div>
        </Card>
      </section>

      <section>
        <p className="mb-2 text-xs uppercase tracking-[0.24em] text-zinc-500">Games</p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {gameCards.map((game) => (
            <Link
              key={game.href}
              href={game.href}
              className={`group rounded-lg border border-red-500/20 bg-gradient-to-br ${game.accent} p-3 transition hover:-translate-y-0.5 hover:border-red-400/40`}
            >
              <div className="flex h-full min-h-[88px] flex-col justify-between">
                <span className="text-2xl">{game.icon}</span>
                <span className="text-sm font-semibold text-white group-hover:text-red-100">{game.title}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2 border-zinc-800 bg-zinc-950/80">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-200">Highlights</h2>
            <div className="text-xs text-zinc-500">{loading ? "Loading..." : `${highlights.length} players`}</div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="py-2 pr-4">Username</th>
                  <th className="py-2 pr-4">Amount</th>
                  <th className="py-2 pr-4">Rank</th>
                  <th className="py-2">Level</th>
                </tr>
              </thead>
              <tbody>
                {highlights.length ? (
                  highlights.map((row) => (
                    <tr key={row.userId} className="border-t border-zinc-900">
                      <td className="py-2 pr-4 text-zinc-200">{row.userLabel}</td>
                      <td className="py-2 pr-4 text-amber-300">{toCoins(row.balanceAtomic)}</td>
                      <td className="py-2 pr-4 text-zinc-300">#{row.rank}</td>
                      <td className="py-2 text-zinc-200">{row.level}</td>
                    </tr>
                  ))
                ) : (
                  <tr className="border-t border-zinc-900">
                    <td colSpan={4} className="py-5 text-center text-zinc-500">
                      No entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/80">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-200">Quick access</h2>
          <div className="mt-3 space-y-2 text-sm">
            <Link href="/profile" className="block rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-200 hover:border-red-500/30">
              Profile & Vault
            </Link>
            <Link href="/fairness" className="block rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-200 hover:border-red-500/30">
              Provably Fair
            </Link>
            <Link href="/affiliates" className="block rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-200 hover:border-red-500/30">
              Affiliates
            </Link>
            <Link href="/support" className="block rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-200 hover:border-red-500/30">
              Support
            </Link>
          </div>
        </Card>
      </section>
    </div>
  );
}
