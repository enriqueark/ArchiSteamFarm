import { useEffect, useMemo, useState } from "react";
import Card from "@/components/Card";
import Button from "@/components/Button";
import Input from "@/components/Input";
import {
  applyAffiliateCode,
  claimAffiliateCommission,
  getAffiliateDashboard,
  saveAffiliateCode,
  type AffiliateDashboard
} from "@/lib/api";
import { useAuthUI } from "@/lib/auth-ui";
import { useToast } from "@/lib/toast";

const fmtUsd = (value: number): string =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

export default function AffiliatesPage() {
  const { authed, openAuth } = useAuthUI();
  const { showError, showSuccess } = useToast();
  const [dashboard, setDashboard] = useState<AffiliateDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState(false);
  const [applyingCode, setApplyingCode] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [myCodeInput, setMyCodeInput] = useState("");
  const [applyCodeInput, setApplyCodeInput] = useState("");

  const loadDashboard = async () => {
    const data = await getAffiliateDashboard();
    setDashboard(data);
    if (data.myCode?.code) {
      setMyCodeInput(data.myCode.code);
    }
  };

  useEffect(() => {
    if (!authed) {
      setDashboard(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    loadDashboard()
      .catch(() => {
        if (!cancelled) {
          setDashboard(null);
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

  const stats = useMemo(() => {
    const referrals = dashboard?.stats.referralCount ?? 0;
    const wageredUsd = Number(dashboard?.stats.totalWageredAtomic ?? "0") / 1e8;
    const commissionUsd = Number(dashboard?.stats.totalCommissionAtomic ?? "0") / 1e8;
    const claimableUsd = Number(dashboard?.stats.claimableCommissionAtomic ?? "0") / 1e8;
    return {
      referrals,
      wageredUsd,
      commissionUsd,
      claimableUsd
    };
  }, [dashboard]);

  const handleSaveCode = async () => {
    if (!myCodeInput.trim() || savingCode) {
      return;
    }
    setSavingCode(true);
    try {
      const saved = await saveAffiliateCode(myCodeInput);
      setMyCodeInput(saved.code);
      await loadDashboard();
      showSuccess(`Affiliate code saved: ${saved.code}`);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Could not save affiliate code");
    } finally {
      setSavingCode(false);
    }
  };

  const handleApplyCode = async () => {
    if (!applyCodeInput.trim() || applyingCode || dashboard?.appliedCode) {
      return;
    }
    setApplyingCode(true);
    try {
      await applyAffiliateCode(applyCodeInput);
      await loadDashboard();
      showSuccess("Affiliate code applied.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Could not apply affiliate code");
    } finally {
      setApplyingCode(false);
    }
  };

  const handleClaim = async () => {
    if (claiming) {
      return;
    }
    setClaiming(true);
    try {
      const claimed = await claimAffiliateCommission();
      await loadDashboard();
      showSuccess(`Claimed ${fmtUsd(Number(claimed.claimedAtomic) / 1e8)}.`);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Could not claim earnings");
    } finally {
      setClaiming(false);
    }
  };

  if (!authed) {
    return (
      <Card title="Affiliates">
        <p className="text-sm text-gray-300">Sign in to use the affiliate system.</p>
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

  if (loading) {
    return <Card title="Affiliates">Loading affiliates...</Card>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-white">Affiliates</h1>

      <Card className="border-cyan-500/20 bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950">
        <p className="text-cyan-300 text-sm font-semibold uppercase tracking-wider">Real data</p>
        <h2 className="mt-1 text-3xl font-extrabold text-white">Affiliate Program</h2>
        <p className="mt-2 text-sm text-slate-300 max-w-2xl">
          Create your affiliate code and track your earnings. Invite other players and earn a commission based on their
          activity.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="w-64">
            <Input
              label="Create your affiliate code"
              value={myCodeInput}
              onChange={(e) => setMyCodeInput(e.target.value.toUpperCase())}
              placeholder="AFFILIATE-CODE"
            />
          </div>
          <Button
            className="h-10 px-5 bg-lime-500 hover:bg-lime-400 text-black"
            onClick={() => {
              void handleSaveCode();
            }}
            disabled={savingCode}
          >
            {savingCode ? "Saving..." : "Save"}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="w-64">
            <Input
              label="Apply referral code"
              value={applyCodeInput}
              onChange={(e) => setApplyCodeInput(e.target.value.toUpperCase())}
              placeholder="ENTER CODE"
              disabled={Boolean(dashboard?.appliedCode)}
            />
          </div>
          <Button
            variant="secondary"
            className="h-10 px-5"
            onClick={() => {
              void handleApplyCode();
            }}
            disabled={applyingCode || Boolean(dashboard?.appliedCode)}
          >
            {dashboard?.appliedCode ? "Already applied" : applyingCode ? "Applying..." : "Apply"}
          </Button>
          {dashboard?.appliedCode ? (
            <p className="text-xs text-slate-300">
              Applied: <span className="font-semibold">{dashboard.appliedCode.code}</span>
            </p>
          ) : null}
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
            {dashboard?.referrals.length ? "Stats loaded from real data" : "No referral data yet."}
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
            <Button
              className="mt-3 w-full bg-lime-500 hover:bg-lime-400 text-black"
              disabled={claiming || stats.claimableUsd <= 0}
              onClick={() => {
                void handleClaim();
              }}
            >
              {claiming ? "Claiming..." : "Claim Earnings"}
            </Button>
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
              {dashboard?.referrals.length ? (
                dashboard.referrals.map((row) => (
                  <tr key={row.referralId} className="border-t border-slate-800">
                    <td className="py-2 pr-4">#{row.user.publicId ?? "-"}</td>
                    <td className="py-2 pr-4">{new Date(row.createdAt).toLocaleDateString("en-US")}</td>
                    <td className="py-2 pr-4">{row.user.userLabel}</td>
                    <td className="py-2 pr-4">{fmtUsd(Number(row.totalWageredAtomic) / 1e8)}</td>
                    <td className="py-2 pr-4">{fmtUsd(Number(row.totalCommissionAtomic) / 1e8)}</td>
                    <td className="py-2 pr-4">{fmtUsd(Number(row.bonusReceivedAtomic) / 1e8)}</td>
                    <td className="py-2">{row.active ? "Yes" : "No"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500 border-t border-slate-800">
                    No data found...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
