import { useMemo } from "react";
import Card from "@/components/Card";
import Button from "@/components/Button";

const fmtUsd = (value: number): string =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

export default function AffiliatesPage() {
  const stats = useMemo(
    () => ({
      referrals: 0,
      wageredUsd: 0,
      commissionUsd: 0,
      claimableUsd: 0
    }),
    []
  );

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-white">Affiliates</h1>

      <Card className="border-cyan-500/20 bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950">
        <p className="text-cyan-300 text-sm font-semibold uppercase tracking-wider">Upgrader</p>
        <h2 className="mt-1 text-3xl font-extrabold text-white">Affiliate Program</h2>
        <p className="mt-2 text-sm text-slate-300 max-w-2xl">
          Create your affiliate code and track your earnings. Invite other players and earn a commission based on their
          activity.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400 uppercase tracking-wide">Create your affiliate code</label>
            <input
              className="h-10 w-64 rounded border border-slate-700 bg-slate-900 px-3 text-sm text-white placeholder-slate-500"
              placeholder="affiliate-code"
            />
          </div>
          <Button className="h-10 px-5 bg-lime-500 hover:bg-lime-400 text-black">Save</Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Earning Statistics</h3>
            <div className="flex items-center gap-2 text-xs">
              <button className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-200">All Time</button>
              <button className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-400">1 Month</button>
              <button className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-400">1 Week</button>
            </div>
          </div>
          <div className="mt-4 flex h-64 items-center justify-center rounded border border-slate-800 bg-slate-950/50 text-slate-500">
            No data...
          </div>
        </Card>

        <div className="space-y-3">
          <Card className="bg-slate-900/70">
            <p className="text-xs uppercase tracking-wide text-slate-400">Amount of referrals</p>
            <p className="mt-2 text-2xl font-bold text-white">{stats.referrals}</p>
          </Card>
          <Card className="bg-slate-900/70">
            <p className="text-xs uppercase tracking-wide text-slate-400">Total wagered value</p>
            <p className="mt-2 text-2xl font-bold text-white">{fmtUsd(stats.wageredUsd)}</p>
          </Card>
          <Card className="bg-slate-900/70">
            <p className="text-xs uppercase tracking-wide text-slate-400">Total commission</p>
            <p className="mt-2 text-2xl font-bold text-white">{fmtUsd(stats.commissionUsd)}</p>
          </Card>
          <Card className="border-lime-500/30 bg-gradient-to-br from-slate-900 to-lime-950/40">
            <p className="text-xs uppercase tracking-wide text-slate-300">Claimable earnings</p>
            <p className="mt-2 text-2xl font-bold text-white">{fmtUsd(stats.claimableUsd)}</p>
            <Button className="mt-3 w-full bg-lime-500 hover:bg-lime-400 text-black">Claim Earnings</Button>
          </Card>
        </div>
      </div>

      <Card title="Referrals">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="py-2 pr-4">ID</th>
                <th className="py-2 pr-4">Date referred</th>
                <th className="py-2 pr-4">User</th>
                <th className="py-2 pr-4">Amount wagered</th>
                <th className="py-2 pr-4">Commission</th>
                <th className="py-2 pr-4">Deposit</th>
                <th className="py-2">Active</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-500 border-t border-slate-800">
                  No data found...
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
