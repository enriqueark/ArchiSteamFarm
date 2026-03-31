import { useEffect, useMemo, useState } from "react";

import Button from "@/components/Button";
import Card from "@/components/Card";
import Input from "@/components/Input";
import {
  beginTwoFactorSetup,
  depositToVault,
  disableTwoFactor,
  getTwoFactorState,
  getProfileSummary,
  getVaultState,
  setProfileVisibility,
  verifyTwoFactorSetup,
  withdrawFromVault,
  type ProfileSummary,
  type TwoFactorState,
  type VaultState
} from "@/lib/api";
import { useAuthUI } from "@/lib/auth-ui";
import { useToast } from "@/lib/toast";

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
  const { showError, showSuccess } = useToast();
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [twoFactorState, setTwoFactorState] = useState<TwoFactorState | null>(null);
  const [twoFactorSetup, setTwoFactorSetup] = useState<{
    secret: string;
    otpauthUrl: string;
    qrDataUrl: string;
  } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorBusy, setTwoFactorBusy] = useState<"idle" | "setup" | "verify" | "disable">("idle");
  const [vault, setVault] = useState<VaultState | null>(null);
  const [vaultDepositInput, setVaultDepositInput] = useState("");
  const [vaultWithdrawInput, setVaultWithdrawInput] = useState("");
  const [vaultLockDuration, setVaultLockDuration] = useState<"NONE" | "1H" | "1D" | "3D" | "7D">("NONE");
  const [vaultBusy, setVaultBusy] = useState<"idle" | "deposit" | "withdraw">("idle");
  const [loading, setLoading] = useState(true);
  const [savingVisibility, setSavingVisibility] = useState(false);

  useEffect(() => {
    if (!authed) {
      setSummary(null);
      setTwoFactorState(null);
      setTwoFactorSetup(null);
      setVault(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    Promise.allSettled([getProfileSummary(), getTwoFactorState(), getVaultState()])
      .then((results) => {
        if (cancelled) {
          return;
        }
        const [profileResult, twoFactorResult, vaultResult] = results;
        if (profileResult.status === "fulfilled") {
          setSummary(profileResult.value);
        } else {
          setSummary(null);
        }
        if (twoFactorResult.status === "fulfilled") {
          setTwoFactorState(twoFactorResult.value);
        } else {
          setTwoFactorState(null);
        }
        if (vaultResult.status === "fulfilled") {
          setVault(vaultResult.value);
        } else {
          setVault(null);
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

  const username = useMemo(() => {
    const email = summary?.user.email ?? "";
    const [name] = email.split("@");
    return name || "Player";
  }, [summary?.user.email]);

  const level = summary?.user.level ?? 1;
  const xpCurrent = Number(summary?.user.levelXpAtomic ?? "0");
  const xpBand = 10_000;
  const xpInBand = Math.max(0, xpCurrent % xpBand);
  const xpTarget = xpCurrent - xpInBand + xpBand;
  const progressPct = Math.max(0, Math.min(100, (xpInBand / xpBand) * 100));
  const memberSince = summary?.user.createdAt
    ? new Date(summary.user.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "-";
  const totalBalance = toCoins(summary?.wallet.balanceAtomic ?? "0");
  const deposits = toCoins(summary?.totals.depositsAtomic ?? "0");
  const withdrawals = toCoins(summary?.totals.withdrawalsAtomic ?? "0");
  const profileVisible = summary?.user.profileVisible ?? true;
  const fallbackEmail = summary?.user.email ?? "player@casino.local";
  const vaultTotalCoins = toCoins(vault?.balanceAtomic ?? "0");
  const vaultAvailableCoins = toCoins(vault?.availableAtomic ?? "0");
  const vaultLockedCoins = toCoins(vault?.lockedAtomic ?? "0");

  const toggleProfileVisibility = async () => {
    if (!summary || savingVisibility) {
      return;
    }
    const next = !summary.user.profileVisible;
    setSavingVisibility(true);
    try {
      await setProfileVisibility(next);
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              user: {
                ...prev.user,
                profileVisible: next
              }
            }
          : prev
      );
      showSuccess(next ? "Profile set to visible." : "Profile set to hidden.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Unable to update profile visibility");
    } finally {
      setSavingVisibility(false);
    }
  };

  const reloadVault = async () => {
    const next = await getVaultState();
    setVault(next);
  };

  const startTwoFactorSetup = async () => {
    if (twoFactorBusy !== "idle") {
      return;
    }
    setTwoFactorBusy("setup");
    try {
      const setup = await beginTwoFactorSetup();
      setTwoFactorSetup(setup);
      setTwoFactorState({ enabled: false, setupPending: true });
      showSuccess("2FA setup started. Scan the QR and confirm the code.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Unable to start 2FA setup");
    } finally {
      setTwoFactorBusy("idle");
    }
  };

  const confirmTwoFactorSetup = async () => {
    if (twoFactorBusy !== "idle") {
      return;
    }
    const code = twoFactorCode.trim();
    if (!/^\d{6,8}$/.test(code)) {
      showError("Enter a valid authenticator code.");
      return;
    }
    setTwoFactorBusy("verify");
    try {
      await verifyTwoFactorSetup(code);
      setTwoFactorState({ enabled: true, setupPending: false });
      setTwoFactorSetup(null);
      setTwoFactorCode("");
      showSuccess("Google 2FA enabled.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Unable to verify 2FA code");
    } finally {
      setTwoFactorBusy("idle");
    }
  };

  const disableTwoFactorNow = async () => {
    if (twoFactorBusy !== "idle") {
      return;
    }
    const code = twoFactorCode.trim();
    if (!/^\d{6,8}$/.test(code)) {
      showError("Enter your current 2FA code to disable.");
      return;
    }
    setTwoFactorBusy("disable");
    try {
      await disableTwoFactor(code);
      setTwoFactorState({ enabled: false, setupPending: false });
      setTwoFactorSetup(null);
      setTwoFactorCode("");
      showSuccess("Google 2FA disabled.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Unable to disable 2FA");
    } finally {
      setTwoFactorBusy("idle");
    }
  };

  const handleVaultDeposit = async () => {
    if (vaultBusy !== "idle") {
      return;
    }
    const amountCoins = Number(vaultDepositInput);
    if (!Number.isFinite(amountCoins) || amountCoins <= 0) {
      showError("Enter a valid deposit amount.");
      return;
    }
    setVaultBusy("deposit");
    try {
      await depositToVault({
        amountCoins,
        lockDuration: vaultLockDuration === "NONE" ? undefined : vaultLockDuration
      });
      const [nextVault, nextSummary] = await Promise.all([getVaultState(), getProfileSummary()]);
      setVault(nextVault);
      setSummary(nextSummary);
      setVaultDepositInput("");
      showSuccess("Vault deposit completed.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Vault deposit failed");
    } finally {
      setVaultBusy("idle");
    }
  };

  const handleVaultWithdraw = async () => {
    if (vaultBusy !== "idle") {
      return;
    }
    const amountCoins = Number(vaultWithdrawInput);
    if (!Number.isFinite(amountCoins) || amountCoins <= 0) {
      showError("Enter a valid withdraw amount.");
      return;
    }
    setVaultBusy("withdraw");
    try {
      await withdrawFromVault({ amountCoins });
      const [nextVault, nextSummary] = await Promise.all([getVaultState(), getProfileSummary()]);
      setVault(nextVault);
      setSummary(nextSummary);
      setVaultWithdrawInput("");
      showSuccess("Vault withdraw completed.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Vault withdraw failed");
    } finally {
      setVaultBusy("idle");
    }
  };

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

  if (!summary) {
    return (
      <Card title="Profile">
        <p className="text-sm text-gray-300">Unable to load your profile right now.</p>
      </Card>
    );
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
              <p className="text-xs text-gray-400">
                User ID:{" "}
                <span className="font-semibold text-gray-200">
                  {summary?.user.publicId ? `#${summary.user.publicId}` : "-"}
                </span>
              </p>
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
          <p className="text-3xl font-bold text-white">{formatCoins(deposits)}</p>
          <p className="text-sm text-gray-300">Deposits</p>
        </Card>
        <Card className="bg-[#1f2437] border-[#2a3349]">
          <p className="text-3xl font-bold text-white">{formatCoins(withdrawals)}</p>
          <p className="text-sm text-gray-300">Withdraws</p>
        </Card>
        <Card className="bg-[#1f2437] border-[#2a3349]">
          <p className="text-3xl font-bold text-white">{formatCoins(totalBalance)}</p>
          <p className="text-sm text-gray-300">Current Balance (COINS)</p>
        </Card>
      </div>

      <Card title="Account details" className="bg-[#1f2437] border-[#2a3349]">
        <Input label="Username" value={username} readOnly />
        <div className="mt-3">
          <Input label="Email" value={fallbackEmail} readOnly />
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            disabled={savingVisibility}
            onClick={() => {
              void toggleProfileVisibility();
            }}
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

      <Card title="Google 2FA" className="bg-[#1f2437] border-[#2a3349]">
        <p className="text-sm text-gray-300">
          Status:{" "}
          <span className={twoFactorState?.enabled ? "text-green-300 font-semibold" : "text-yellow-300 font-semibold"}>
            {twoFactorState?.enabled ? "Enabled" : "Disabled"}
          </span>
        </p>
        <p className="mt-1 text-xs text-gray-400">
          When enabled, login requires your 6-digit authenticator code.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={twoFactorBusy !== "idle"}
            onClick={() => {
              void startTwoFactorSetup();
            }}
          >
            {twoFactorBusy === "setup" ? "Generating..." : "Generate / Refresh QR"}
          </Button>
          {twoFactorState?.enabled ? (
            <Button
              variant="danger"
              disabled={twoFactorBusy !== "idle"}
              onClick={() => {
                void disableTwoFactorNow();
              }}
            >
              {twoFactorBusy === "disable" ? "Disabling..." : "Disable 2FA"}
            </Button>
          ) : null}
        </div>

        <div className="mt-3 max-w-xs">
          <Input
            label={twoFactorState?.enabled ? "Current authenticator code" : "Code to confirm setup"}
            placeholder="123456"
            value={twoFactorCode}
            onChange={(event) => setTwoFactorCode(event.target.value)}
            maxLength={8}
          />
          {!twoFactorState?.enabled ? (
            <Button
              className="mt-2 w-full"
              disabled={twoFactorBusy !== "idle"}
              onClick={() => {
                void confirmTwoFactorSetup();
              }}
            >
              {twoFactorBusy === "verify" ? "Verifying..." : "Enable 2FA"}
            </Button>
          ) : null}
        </div>

        {twoFactorSetup ? (
          <div className="mt-4 rounded border border-gray-700 bg-gray-900/60 p-3">
            <p className="text-xs text-gray-400">Scan this QR in Google Authenticator (or compatible app):</p>
            <img src={twoFactorSetup.qrDataUrl} alt="2FA QR" className="mt-2 h-40 w-40 rounded bg-white p-2" />
            <p className="mt-2 break-all text-xs text-gray-300">Secret: {twoFactorSetup.secret}</p>
          </div>
        ) : null}
      </Card>

      <Card title="Vault" className="bg-[#1f2437] border-[#2a3349]">
        <p className="text-xs text-gray-400">Store your coins and optionally lock them for fixed times.</p>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="rounded border border-[#2a3349] bg-[#182136] p-3">
            <p className="text-xs text-gray-400">Vault total</p>
            <p className="text-lg font-bold text-white">{formatCoins(vaultTotalCoins)} COINS</p>
          </div>
          <div className="rounded border border-[#2a3349] bg-[#182136] p-3">
            <p className="text-xs text-gray-400">Available</p>
            <p className="text-lg font-bold text-white">{formatCoins(vaultAvailableCoins)} COINS</p>
          </div>
          <div className="rounded border border-[#2a3349] bg-[#182136] p-3">
            <p className="text-xs text-gray-400">Locked</p>
            <p className="text-lg font-bold text-white">{formatCoins(vaultLockedCoins)} COINS</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded border border-[#2a3349] bg-[#182136] p-3">
            <h3 className="text-sm font-semibold text-white">Deposit to vault</h3>
            <div className="mt-2">
              <Input
                label="Amount (COINS)"
                value={vaultDepositInput}
                onChange={(event) => setVaultDepositInput(event.target.value)}
                placeholder="10"
              />
            </div>
            <div className="mt-2">
              <label className="text-sm text-gray-400">Lock duration</label>
              <select
                className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100"
                value={vaultLockDuration}
                onChange={(event) =>
                  setVaultLockDuration(event.target.value as "NONE" | "1H" | "1D" | "3D" | "7D")
                }
              >
                <option value="NONE">No lock</option>
                <option value="1H">1 hour</option>
                <option value="1D">1 day</option>
                <option value="3D">3 days</option>
                <option value="7D">7 days</option>
              </select>
            </div>
            <Button
              className="mt-3 w-full"
              disabled={vaultBusy !== "idle"}
              onClick={() => {
                void handleVaultDeposit();
              }}
            >
              {vaultBusy === "deposit" ? "Depositing..." : "Deposit"}
            </Button>
          </div>

          <div className="rounded border border-[#2a3349] bg-[#182136] p-3">
            <h3 className="text-sm font-semibold text-white">Withdraw from vault</h3>
            <div className="mt-2">
              <Input
                label="Amount (COINS)"
                value={vaultWithdrawInput}
                onChange={(event) => setVaultWithdrawInput(event.target.value)}
                placeholder="5"
              />
            </div>
            <Button
              className="mt-3 w-full"
              disabled={vaultBusy !== "idle"}
              onClick={() => {
                void handleVaultWithdraw();
              }}
            >
              {vaultBusy === "withdraw" ? "Withdrawing..." : "Withdraw"}
            </Button>
            <Button
              variant="secondary"
              className="mt-2 w-full"
              onClick={() => {
                void reloadVault();
              }}
            >
              Refresh vault state
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <h3 className="text-sm font-semibold text-white">Active locks</h3>
          {!vault?.locks.length ? (
            <p className="mt-1 text-xs text-gray-400">No active locks.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {vault.locks.map((lock) => (
                <div key={lock.id} className="rounded border border-gray-700 bg-gray-900/60 px-3 py-2 text-xs text-gray-200">
                  <p>Amount: {formatCoins(toCoins(lock.amountAtomic))} COINS</p>
                  <p>Unlocks: {new Date(lock.unlockAt).toLocaleString("en-US")}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

