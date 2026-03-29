import { useEffect, useMemo, useState } from "react";

import Card from "@/components/Card";
import Input from "@/components/Input";
import { getMe, getWallets, type User, type Wallet } from "@/lib/api";
import { useAuthUI } from "@/lib/auth-ui";

const toCoins = (atomic: string): number => {
  const value = Number(atomic);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value / 1e8;
};

const formatCoins = (value: number): string =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

export default function ProfilePage() {
  const { authed, openAuth } = useAuthUI();
  const [user, setUser] = useState<User | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileVisible, setProfileVisible] = useState(true);

  useEffect(() => {
    if (!authed) {
      setUser(null);
      setWallets([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    Promise.all([getMe(), getWallets()])
      .then(([me, rows]) => {
        if (cancelled) return;
        setUser(me);
        setWallets(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setWallets([]);
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

  const username = useMemo(() => {
    const email = user?.email ?? "";
    const [name] = email.split("@");
    return name || "Player";
  }, [user?.email]);

  const level = user?.progression?.level ?? 1;
  const xpCurrent = Number(user?.progression?.xpAtomic ?? "0");
  const xpBand = 10_000;
  const xpInBand = Math.max(0, xpCurrent % xpBand);
  const xpTarget = xpCurrent - xpInBand + xpBand;
  const progressPct = Math.max(0, Math.min(100, (xpInBand / xpBand) * 100));
  const memberSince = user?.createdAt ? new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "-";
  const totalBalance = wallets.reduce((sum, wallet) => sum + toCoins(wallet.balanceAtomic), 0);

  if (!authed) {
    return (
      <Card title="Profile">
        <p className="text-sm text-gray-300">Sign in to view your profile page.</p>
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
    return <Card title="Profile">Loading profile...</Card>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-white">Profile</h1>

      <Card className="bg-[#1f2437] border-[#2a3349]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#dce6ff] text-2xl text-[#404969]">🙂</div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-white">{username}</span>
                <span className="rounded bg-cyan-400/90 px-2 py-0.5 text-xs font-bold text-[#10263a]">{level}</span>
              </div>
              <p className="text-sm text-gray-300">Member since {memberSince}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-gray-200">
              {xpInBand.toLocaleString("en-US")} / {xpTarget.toLocaleString("en-US")} XP
            </p>
          </div>
        </div>
        <div className="mt-3 h-2 w-full rounded bg-[#101827]">
          <div className="h-2 rounded bg-cyan-400 transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="bg-[#1f2437] border-[#2a3349]">
          <p className="text-3xl font-bold text-white">$0.00</p>
          <p className="text-sm text-gray-300">Deposits</p>
        </Card>
        <Card className="bg-[#1f2437] border-[#2a3349]">
          <p className="text-3xl font-bold text-white">$0.00</p>
          <p className="text-sm text-gray-300">Withdraws</p>
        </Card>
        <Card className="bg-[#1f2437] border-[#2a3349]">
          <p className="text-3xl font-bold text-white">{formatCoins(totalBalance)}</p>
          <p className="text-sm text-gray-300">Current Balance (COINS)</p>
        </Card>
      </div>

      <Card title="Account details" className="bg-[#1f2437] border-[#2a3349]">
        <Input label="Username" value={username} readOnly />
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setProfileVisible((prev) => !prev)}
            className={`relative h-7 w-12 rounded-full transition-colors ${profileVisible ? "bg-indigo-600" : "bg-gray-700"}`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
                profileVisible ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <div>
            <p className="font-semibold text-white">Profile Visibility</p>
            <p className="text-sm text-gray-400">Hide my stats from other users.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

