import { useEffect, useState } from "react";
import Card from "@/components/Card";
import { getLeaderboard, type LeaderboardEntry } from "@/lib/api";
import { useAuthUI } from "@/lib/auth-ui";

const toCoins = (atomic: string): number => {
  const value = Number(atomic);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value / 1e8;
};

const fmt = (value: number): string =>
  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function LeaderboardPage() {
  const { authed, openAuth } = useAuthUI();
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authed) {
      setRows([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    getLeaderboard(50)
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
  }, [authed]);

  if (!authed) {
    return (
      <Card title="Leaderboard">
        <p className="text-sm text-gray-300">Sign in to view leaderboard standings.</p>
        <button
          type="button"
          onClick={() => openAuth("login")}
          className="mt-3 rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Sign in
        </button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-white">Leaderboard</h1>
      <p className="text-sm text-gray-400">Top players by level and progression.</p>

      <Card>
        {loading ? (
          <p className="text-sm text-gray-300">Loading leaderboard...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400">
                  <th className="py-2 pr-4">Rank</th>
                  <th className="py-2 pr-4">User</th>
                  <th className="py-2 pr-4">Public ID</th>
                  <th className="py-2 pr-4">Level</th>
                  <th className="py-2 pr-4">XP</th>
                  <th className="py-2">Balance (COINS)</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((row) => (
                    <tr key={row.userId} className="border-t border-gray-800">
                      <td className="py-2 pr-4 font-semibold text-white">#{row.rank}</td>
                      <td className="py-2 pr-4 text-gray-200">{row.userLabel}</td>
                      <td className="py-2 pr-4 text-gray-300">{row.publicId ? `#${row.publicId}` : "-"}</td>
                      <td className="py-2 pr-4 text-gray-200">{row.level}</td>
                      <td className="py-2 pr-4 text-gray-300">{Number(row.levelXpAtomic).toLocaleString("en-US")}</td>
                      <td className="py-2 text-gray-200">{fmt(toCoins(row.balanceAtomic))}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="border-t border-gray-800 py-6 text-center text-gray-500">
                      No leaderboard entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

