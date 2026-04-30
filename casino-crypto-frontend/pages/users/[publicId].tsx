import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";

import Card from "@/components/Card";
import CoinAmount from "@/components/CoinAmount";
import {
  getChatProfileByPublicId,
  getChatProfileByUserId,
  type ChatPublicProfileSummary
} from "@/lib/api";

const COIN_FACTOR = 1e8;

function atomicToCoins(atomic: string): string {
  const n = Number(atomic || "0");
  if (!Number.isFinite(n)) return "0.00";
  return (n / COIN_FACTOR).toFixed(2);
}

export default function UserPublicProfilePage() {
  const router = useRouter();
  const param = useMemo(() => {
    const value = router.query.publicId;
    return Array.isArray(value) ? value[0] : value;
  }, [router.query.publicId]);

  const [data, setData] = useState<ChatPublicProfileSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!param) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        let summary: ChatPublicProfileSummary;
        if (/^\d+$/.test(param)) {
          summary = await getChatProfileByPublicId(Number.parseInt(param, 10));
        } else {
          summary = await getChatProfileByUserId(param);
        }
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
  }, [param]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">User Profile</h1>
      <Card title="Profile stats">
        {loading ? <p className="text-sm text-gray-400">Loading profile...</p> : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {data ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
              <p className="m-0 text-gray-400">Username</p>
              <p className="m-0 mt-1 text-white font-semibold">{data.user.username}</p>
            </div>
            <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
              <p className="m-0 text-gray-400">UID</p>
              <p className="m-0 mt-1 text-white font-semibold">#{data.user.publicId ?? "N/A"}</p>
            </div>
            <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
              <p className="m-0 text-gray-400">Level</p>
              <p className="m-0 mt-1 text-white font-semibold">{data.user.level}</p>
            </div>
            <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
              <p className="m-0 text-gray-400">Rewards redeemed</p>
              <div className="mt-1">
                <CoinAmount
                  amount={data.stats.rewardsRedeemedCoins}
                  iconSize={16}
                  textClassName="text-white font-semibold"
                />
              </div>
            </div>

            {!data.user.profileVisible ? (
              <div className="rounded-lg border border-[#3a2626] bg-[#161010] p-3 md:col-span-2">
                <p className="m-0 text-red-300 font-semibold">This profile is private.</p>
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3 md:col-span-2">
                  <p className="m-0 text-gray-400">Total wagered</p>
                  <div className="mt-1">
                    <CoinAmount
                      amount={data.stats.wageredTotalCoins}
                      iconSize={16}
                      textClassName="text-white font-semibold"
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
                  <p className="m-0 text-gray-400">Case battles wagered</p>
                  <div className="mt-1">
                    <CoinAmount
                      amount={atomicToCoins(data.stats.wageredByMode.caseBattlesAtomic)}
                      iconSize={16}
                      textClassName="text-white font-semibold"
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
                  <p className="m-0 text-gray-400">Case opening wagered</p>
                  <div className="mt-1">
                    <CoinAmount
                      amount={atomicToCoins(data.stats.wageredByMode.caseOpeningAtomic)}
                      iconSize={16}
                      textClassName="text-white font-semibold"
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
                  <p className="m-0 text-gray-400">Mines wagered</p>
                  <div className="mt-1">
                    <CoinAmount
                      amount={atomicToCoins(data.stats.wageredByMode.minesAtomic)}
                      iconSize={16}
                      textClassName="text-white font-semibold"
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
                  <p className="m-0 text-gray-400">Blackjack wagered</p>
                  <div className="mt-1">
                    <CoinAmount
                      amount={atomicToCoins(data.stats.wageredByMode.blackjackAtomic)}
                      iconSize={16}
                      textClassName="text-white font-semibold"
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3 md:col-span-2">
                  <p className="m-0 text-gray-400">Roulette wagered</p>
                  <div className="mt-1">
                    <CoinAmount
                      amount={atomicToCoins(data.stats.wageredByMode.rouletteAtomic)}
                      iconSize={16}
                      textClassName="text-white font-semibold"
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
                  <p className="m-0 text-gray-400">Highest single win</p>
                  <div className="mt-1">
                    <CoinAmount
                      amount={data.stats.maxSingleWinCoins}
                      iconSize={16}
                      textClassName="text-white font-semibold"
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
                  <p className="m-0 text-gray-400">Highest multiplier</p>
                  <p className="m-0 mt-1 text-white font-semibold">{data.stats.maxSingleMultiplier}x</p>
                </div>
              </>
            )}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
