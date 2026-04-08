import { useEffect, useMemo, useState } from "react";

import Card from "@/components/Card";
import {
  getMyGameHistory,
  type PaginatedResponse,
  type UserGameHistoryItem
} from "@/lib/api";

const PAGE_SIZE = 50;

type GameMode = "ALL" | "MINES" | "BLACKJACK" | "ROULETTE" | "CASES" | "BATTLES";

export default function GameHistoryPage() {
  const [mode, setMode] = useState<GameMode>("ALL");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PaginatedResponse<UserGameHistoryItem> | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    void getMyGameHistory({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, mode })
      .then((response) => {
        if (!mounted) return;
        setData(response);
      })
      .catch((reason: unknown) => {
        if (!mounted) return;
        setError(reason instanceof Error ? reason.message : "Failed to load game history");
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [mode, page]);

  const totalPages = useMemo(() => {
    const total = data?.pagination.total ?? 0;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [data]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">Game History</h1>
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-400">Game mode</label>
          <select
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as GameMode);
              setPage(1);
            }}
            className="rounded-lg border border-[#2a2a2a] bg-[#101010] px-3 py-2 text-sm text-white"
          >
            <option value="ALL">All</option>
            <option value="MINES">Mines</option>
            <option value="BLACKJACK">Blackjack</option>
            <option value="ROULETTE">Roulette</option>
            <option value="CASES">Cases</option>
            <option value="BATTLES">Battles</option>
          </select>
          <p className="ml-auto text-xs text-gray-400">
            Total bets: {data?.pagination.total ?? 0}
          </p>
        </div>

        {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-gray-400">
              <tr>
                <th className="border-b border-[#222] px-3 py-2">Date</th>
                <th className="border-b border-[#222] px-3 py-2">Game</th>
                <th className="border-b border-[#222] px-3 py-2">Status</th>
                <th className="border-b border-[#222] px-3 py-2">Wager</th>
                <th className="border-b border-[#222] px-3 py-2">Payout</th>
                <th className="border-b border-[#222] px-3 py-2">Profit</th>
                <th className="border-b border-[#222] px-3 py-2">Reference</th>
              </tr>
            </thead>
            <tbody>
              {!loading && !data?.items.length ? (
                <tr>
                  <td className="px-3 py-4 text-gray-500" colSpan={7}>
                    No game history found.
                  </td>
                </tr>
              ) : null}
              {data?.items.map((item) => {
                const positiveProfit = !item.profitCoins.startsWith("-");
                return (
                  <tr key={item.id}>
                    <td className="border-b border-[#161616] px-3 py-2 text-gray-200">
                      {new Date(item.playedAt).toLocaleString()}
                    </td>
                    <td className="border-b border-[#161616] px-3 py-2 text-white">
                      {item.gameMode}
                    </td>
                    <td className="border-b border-[#161616] px-3 py-2 text-gray-300">
                      {item.status}
                    </td>
                    <td className="border-b border-[#161616] px-3 py-2 text-gray-200">
                      {item.wagerCoins}
                    </td>
                    <td className="border-b border-[#161616] px-3 py-2 text-gray-200">
                      {item.payoutCoins}
                    </td>
                    <td
                      className={`border-b border-[#161616] px-3 py-2 font-semibold ${
                        positiveProfit ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {item.profitCoins}
                    </td>
                    <td className="border-b border-[#161616] px-3 py-2 font-mono text-xs text-gray-500">
                      {item.reference ?? "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Page {page} / {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-[#2a2a2a] bg-[#121212] px-3 py-2 text-sm text-white disabled:opacity-50"
              disabled={page <= 1 || loading}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Prev
            </button>
            <button
              type="button"
              className="rounded-lg border border-[#2a2a2a] bg-[#121212] px-3 py-2 text-sm text-white disabled:opacity-50"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
