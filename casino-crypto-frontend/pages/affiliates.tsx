import { useEffect, useState } from "react";

import CoinAmount from "@/components/CoinAmount";
import Card from "@/components/Card";
import {
  getAffiliateDashboard,
  type AffiliateDashboard
} from "@/lib/api";

export default function AffiliatesPage() {
  const [dashboard, setDashboard] = useState<AffiliateDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getAffiliateDashboard();
        if (!mounted) return;
        setDashboard(data);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load affiliates");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">Affiliates</h1>
      {loading ? <p className="text-sm text-gray-400">Loading affiliate dashboard...</p> : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {dashboard ? (
        <>
          <Card title="My affiliate code">
            <p className="text-sm text-gray-300">
              {dashboard.myCode ? `Your code: ${dashboard.myCode.code}` : "You don't have an affiliate code yet."}
            </p>
          </Card>
          <Card title="Affiliate stats">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <p className="text-gray-300">Referrals: <span className="text-white font-semibold">{dashboard.stats.referralCount}</span></p>
              <p className="text-gray-300">
                Total wagered:{" "}
                <CoinAmount
                  amount={dashboard.stats.totalWageredCoins}
                  iconSize={16}
                  textClassName="text-white font-semibold"
                />
              </p>
              <p className="text-gray-300">
                Total commission:{" "}
                <CoinAmount
                  amount={dashboard.stats.totalCommissionCoins}
                  iconSize={16}
                  textClassName="text-white font-semibold"
                />
              </p>
              <p className="text-gray-300">
                Claimable:{" "}
                <CoinAmount
                  amount={dashboard.stats.claimableCommissionCoins}
                  iconSize={16}
                  textClassName="text-white font-semibold"
                />
              </p>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
