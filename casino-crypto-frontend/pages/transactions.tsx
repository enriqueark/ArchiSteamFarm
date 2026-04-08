import { useCallback, useEffect, useState } from "react";
import Card from "@/components/Card";
import { getMyTransactions, type PaginatedResponse, type UserTransactionItem } from "@/lib/api";

const PAGE_SIZE = 50;

const kindColor: Record<UserTransactionItem["kind"], string> = {
  DEPOSIT: "text-emerald-400",
  WITHDRAWAL: "text-red-400",
  ADMIN: "text-yellow-300",
  TIP_SENT: "text-red-300",
  TIP_RECEIVED: "text-emerald-300",
  RAIN_TIP: "text-cyan-300",
  RAIN_PAYOUT: "text-emerald-400",
  GAME: "text-sky-300",
  VAULT: "text-purple-300",
  OTHER: "text-gray-300"
};

export default function TransactionsPage() {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<PaginatedResponse<UserTransactionItem> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextOffset = offset) => {
    setLoading(true);
    setError(null);
    try {
      const response = await getMyTransactions(PAGE_SIZE, nextOffset);
      setData(response);
      setOffset(nextOffset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    void load(0);
  }, [load]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = data ? Math.max(1, Math.ceil(data.pagination.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Transactions</h1>
        <p className="text-sm text-gray-400">All deposits, withdraws, admin adjustments, and tips</p>
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-gray-300">
            {data ? `Total: ${data.pagination.total}` : "Total: -"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}
              disabled={loading || offset <= 0}
              className="rounded-btn border border-[#2a2a2a] bg-[#171717] px-3 py-1.5 text-xs text-white disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-xs text-gray-400">
              Page {page}/{totalPages}
            </span>
            <button
              type="button"
              onClick={() => void load(offset + PAGE_SIZE)}
              disabled={loading || !data?.pagination.hasMore}
              className="rounded-btn border border-[#2a2a2a] bg-[#171717] px-3 py-1.5 text-xs text-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>

        {loading ? <p className="text-sm text-gray-400">Loading transactions...</p> : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#232323] text-left text-xs uppercase text-gray-400">
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Direction</th>
                <th className="px-2 py-2">Amount</th>
                <th className="px-2 py-2">Reason</th>
                <th className="px-2 py-2">Reference</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items || []).map((item) => (
                <tr key={item.id} className="border-b border-[#161616]">
                  <td className="px-2 py-2 text-gray-300">{new Date(item.createdAt).toLocaleString()}</td>
                  <td className={`px-2 py-2 font-semibold ${kindColor[item.kind]}`}>{item.kind}</td>
                  <td className={`px-2 py-2 ${item.direction === "CREDIT" ? "text-emerald-300" : "text-red-300"}`}>
                    {item.direction}
                  </td>
                  <td className="px-2 py-2 text-white">{item.amountCoins}</td>
                  <td className="px-2 py-2 text-gray-300">{item.reason}</td>
                  <td className="px-2 py-2 text-gray-500">{item.referenceId || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && (data?.items?.length || 0) === 0 ? (
            <p className="py-4 text-sm text-gray-400">No transactions yet.</p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
