import { useEffect, useState } from "react";

import Card from "@/components/Card";
import { getProfileSummary, type ProfileSummary } from "@/lib/api";

export default function ProfilePage() {
  const [data, setData] = useState<ProfileSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const summary = await getProfileSummary();
        if (!mounted) return;
        setData(summary);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load profile");
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
      <h1 className="text-2xl font-bold text-white">Profile</h1>
      <Card title="Your profile">
        {loading ? <p className="text-sm text-gray-400">Loading profile...</p> : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {data ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
              <p className="m-0 text-gray-400">Username</p>
              <p className="m-0 mt-1 text-white font-semibold">{data.user.email.split("@")[0]}</p>
            </div>
            <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
              <p className="m-0 text-gray-400">Email</p>
              <p className="m-0 mt-1 text-white font-semibold">{data.user.email}</p>
            </div>
            <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
              <p className="m-0 text-gray-400">User ID</p>
              <p className="m-0 mt-1 text-white font-semibold">
                #{data.user.publicId ?? "N/A"} ({data.user.id})
              </p>
            </div>
            <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
              <p className="m-0 text-gray-400">Level / XP</p>
              <p className="m-0 mt-1 text-white font-semibold">
                {data.user.level} / {data.user.levelXp} XP
              </p>
            </div>
            <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3 md:col-span-2">
              <p className="m-0 text-gray-400">Wallet balance</p>
              <p className="m-0 mt-1 text-white font-semibold">
                {data.wallet.balanceCoins} COINS (available {data.wallet.availableCoins} / locked {data.wallet.lockedCoins})
              </p>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
