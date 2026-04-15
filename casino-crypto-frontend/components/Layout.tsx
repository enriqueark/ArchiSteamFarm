import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import ChatPanel from "./ChatPanel";
import Footer from "./Footer";
import LevelBadge from "./LevelBadge";
import NotificationsPanel, { type Notification as HeaderNotification } from "./NotificationsPanel";
import {
  depositVault,
  getLiveWinsTicker,
  getMyCashierNotifications,
  getVaultState,
  getWallets,
  updateMyAvatar,
  type LiveWinTickerItem,
  type VaultLockDuration,
  type VaultState,
  type Wallet,
  withdrawVault
} from "@/lib/api";
import { LIVE_WINS_REFRESH_EVENT } from "@/lib/liveWinsTicker";
import { CasinoSocket, type SocketEvent } from "@/lib/socket";

const sideLinks = [
  { href: "/cases", src: "/assets/e2aff152f333aa01b1f9280bef464454.svg", label: "Cases" },
  { href: "/case-battles", src: "/assets/7739c95aea952fc2e80b31e6dd1cf73d.svg", label: "Case Battle" },
  { href: "/roulette", src: "/assets/35ad40f1a702c98648f4437ed2fd02b6.svg", label: "Roulette" },
  { href: "/mines", src: "/assets/8ffba4817b8664c5480ee873923615b0.svg", label: "Mines" },
  { href: "/blackjack", src: "/assets/90cdff650ad513d6be72c3f0d3a9eea3.svg", label: "Blackjack" },
];

function formatAtomic(val: string, decimals = 8): string {
  const n = Number(val) / Math.pow(10, decimals);
  return n.toFixed(2);
}
function formatCoins(balanceCoins?: string, balanceAtomic?: string): string {
  let n = 0;
  if (balanceCoins && Number.isFinite(Number(balanceCoins))) {
    n = Number(balanceCoins);
  } else if (balanceAtomic) {
    n = Number(balanceAtomic) / Math.pow(10, 8);
  }
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const atomicToCoinsString = (atomic: string, decimals = 2): string => {
  const value = Number(atomic);
  if (!Number.isFinite(value)) return "0.00";
  return (value / 1e8).toFixed(decimals);
};

interface Props {
  children: ReactNode;
  onLogout?: () => void;
  userEmail?: string;
  userLevel?: number;
  userAvatarUrl?: string | null;
  hideFooter?: boolean;
}

const getInitialFromLabel = (label: string | undefined): string => {
  const normalized = (label || "").trim();
  if (!normalized) return "";
  return normalized.slice(0, 1).toUpperCase();
};

export default function Layout({ children, onLogout, userEmail, userLevel, userAvatarUrl, hideFooter = false }: Props) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [hoveredSideHref, setHoveredSideHref] = useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [vaultState, setVaultState] = useState<VaultState | null>(null);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [vaultActionLoading, setVaultActionLoading] = useState(false);
  const [vaultAmountCoins, setVaultAmountCoins] = useState("10");
  const [vaultLockDuration, setVaultLockDuration] = useState<VaultLockDuration>("1H");
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [vaultInfo, setVaultInfo] = useState<string | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [tickerEvents, setTickerEvents] = useState<LiveWinTickerItem[]>([]);
  const socketRef = useRef<CasinoSocket | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const [balanceFlash, setBalanceFlash] = useState<"up" | "down" | null>(null);
  const prevBalanceRef = useRef<string | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [hasNewNotif, setHasNewNotif] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("notifSeen") !== "true";
  });
  const [displayBalance, setDisplayBalance] = useState<string | null>(null);
  const animRef = useRef<number | null>(null);
  const [avatarUrlState, setAvatarUrlState] = useState<string | null>(userAvatarUrl ?? null);
  const [avatarInputValue, setAvatarInputValue] = useState("");
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarInfo, setAvatarInfo] = useState<string | null>(null);
  const [avatarSourceLabel, setAvatarSourceLabel] = useState<"CUSTOM" | "PROVIDER" | "INITIAL">("INITIAL");
  const [cachedUsername, setCachedUsername] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const stored = localStorage.getItem("lastKnownUsername");
    return (stored || "").trim();
  });
  const latestTickerIdRef = useRef<string | null>(null);
  const hasTickerBootstrappedRef = useRef(false);

  const refreshWallets = useCallback(() => {
    getWallets().then(setWallets).catch(() => {});
  }, []);

  useEffect(() => {
    refreshWallets();
    const interval = setInterval(refreshWallets, 15_000);
    const onRefresh = () => refreshWallets();
    window.addEventListener("refreshBalance", onRefresh);
    return () => { clearInterval(interval); window.removeEventListener("refreshBalance", onRefresh); };
  }, [refreshWallets]);

  const refreshLiveTicker = useCallback(async () => {
    try {
      const response = await getLiveWinsTicker(24);
      const nextItems = (response.items || []).slice(0, 24);
      if (!nextItems.length) {
        if (!hasTickerBootstrappedRef.current) {
          hasTickerBootstrappedRef.current = true;
          setTickerEvents([]);
        }
        return;
      }
      const nextTopId = nextItems[0]?.id ?? null;
      if (!nextTopId) return;
      if (!hasTickerBootstrappedRef.current) {
        hasTickerBootstrappedRef.current = true;
        latestTickerIdRef.current = nextTopId;
        setTickerEvents(nextItems);
        return;
      }
      if (
        nextTopId !== latestTickerIdRef.current ||
        nextItems.length !== tickerEvents.length
      ) {
        latestTickerIdRef.current = nextTopId;
        setTickerEvents(nextItems);
      }
    } catch {
      // keep previous ticker state on transient failures
    }
  }, [tickerEvents.length]);

  useEffect(() => {
    void refreshLiveTicker();
    const interval = setInterval(() => {
      void refreshLiveTicker();
    }, 2_000);
    return () => clearInterval(interval);
  }, [refreshLiveTicker]);

  useEffect(() => {
    const burstRefresh = () => {
      void refreshLiveTicker();
      window.setTimeout(() => {
        void refreshLiveTicker();
      }, 450);
      window.setTimeout(() => {
        void refreshLiveTicker();
      }, 1_200);
      window.setTimeout(() => {
        void refreshLiveTicker();
      }, 2_500);
      window.setTimeout(() => {
        void refreshLiveTicker();
      }, 4_000);
    };
    window.addEventListener(LIVE_WINS_REFRESH_EVENT, burstRefresh);
    return () => {
      window.removeEventListener(LIVE_WINS_REFRESH_EVENT, burstRefresh);
    };
  }, [refreshLiveTicker]);

  useEffect(() => {
    const sock = new CasinoSocket("USDT");
    socketRef.current = sock;
    sock.subscribe((ev: SocketEvent) => {
      if (ev.type === "roulette.round" && ev.data.status === "SETTLED") {
        void refreshLiveTicker();
      }
    });
    sock.connect();
    return () => sock.disconnect();
  }, [refreshLiveTicker]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!profileMenuRef.current) return;
      const target = event.target as Node | null;
      if (target && !profileMenuRef.current.contains(target)) {
        setProfileMenuOpen(false);
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    setProfileMenuOpen(false);
    setNotifOpen(false);
  }, [router.pathname]);

  useEffect(() => {
    setAvatarUrlState(userAvatarUrl ?? null);
    setAvatarSourceLabel(userAvatarUrl ? "PROVIDER" : "INITIAL");
  }, [userAvatarUrl]);

  useEffect(() => {
    const normalized = (userEmail?.split("@")[0] || "").trim();
    if (!normalized) return;
    setCachedUsername(normalized);
    if (typeof window !== "undefined") {
      localStorage.setItem("lastKnownUsername", normalized);
    }
  }, [userEmail]);

  const primaryWallet = wallets.find((w) => w.currency === "COINS") || wallets[0];

  useEffect(() => {
    if (!primaryWallet) return;
    const currentBal = formatCoins(primaryWallet.balanceCoins, primaryWallet.balanceAtomic);
    const prev = prevBalanceRef.current;
    if (prev !== null && prev !== currentBal) {
      const prevNum = parseFloat(prev.replace(/,/g, ""));
      const curNum = parseFloat(currentBal.replace(/,/g, ""));
      if (curNum > prevNum) setBalanceFlash("up");
      else if (curNum < prevNum) setBalanceFlash("down");
      const t = setTimeout(() => setBalanceFlash(null), 1500);

      if (animRef.current) cancelAnimationFrame(animRef.current);
      const duration = 1400;
      const start = performance.now();
      const animate = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const val = prevNum + (curNum - prevNum) * eased;
        setDisplayBalance(val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        if (progress < 1) animRef.current = requestAnimationFrame(animate);
        else animRef.current = null;
      };
      animRef.current = requestAnimationFrame(animate);

      prevBalanceRef.current = currentBal;
      return () => { clearTimeout(t); if (animRef.current) cancelAnimationFrame(animRef.current); };
    }
    prevBalanceRef.current = currentBal;
    setDisplayBalance(currentBal);
  }, [primaryWallet]);
  const displayUsername = (userEmail?.split("@")[0] || cachedUsername || "").slice(0, 20).trim();
  const avatarInitial = getInitialFromLabel(displayUsername);

  const submitAvatarUpdate = async (value: string | null) => {
    setAvatarSaving(true);
    setAvatarError(null);
    setAvatarInfo(null);
    try {
      const result = await updateMyAvatar(value);
      setAvatarUrlState(result.avatarUrl ?? null);
      setAvatarSourceLabel(result.avatarSource ?? (result.avatarUrl ? "CUSTOM" : "INITIAL"));
      setAvatarInfo(value ? "Avatar updated successfully" : "Custom avatar removed");
      setAvatarInputValue("");
      // Keep top-right balance/avatar block updated without full reload.
      window.dispatchEvent(new Event("refreshBalance"));
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Failed to update avatar");
    } finally {
      setAvatarSaving(false);
    }
  };

  const refreshCashierNotifications = useCallback(async () => {
    try {
      const result = await getMyCashierNotifications(10);
      if (typeof window === "undefined") {
        return;
      }

      const incoming: HeaderNotification[] = (result.items ?? []).map((item) => ({
        id: `cashier:${item.id}`,
        title: item.title,
        message: item.description,
        type: "green",
        createdAt: item.createdAt
      }));

      const raw = localStorage.getItem("notifications");
      const existing = raw ? (JSON.parse(raw) as HeaderNotification[]) : [];
      const nonCashier = existing.filter((entry) => !entry.id.startsWith("cashier:"));
      const existingCashierIds = new Set(existing.filter((entry) => entry.id.startsWith("cashier:")).map((entry) => entry.id));
      const hasNewCashierNotification = incoming.some((entry) => !existingCashierIds.has(entry.id));

      const next = [...nonCashier, ...incoming]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 60);
      localStorage.setItem("notifications", JSON.stringify(next));

      if (hasNewCashierNotification) {
        setHasNewNotif(true);
        localStorage.setItem("notifSeen", "false");
      }
    } catch {
      // Keep old notification behavior if cashier endpoint fails.
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!active) return;
      await refreshCashierNotifications();
    };
    void load();
    const interval = setInterval(() => {
      void load();
    }, 20_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [refreshCashierNotifications]);

  const loadVaultState = async () => {
    setVaultLoading(true);
    setVaultError(null);
    try {
      const data = await getVaultState();
      setVaultState(data);
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "Failed to load vault");
    } finally {
      setVaultLoading(false);
    }
  };

  const openVaultModal = async () => {
    setProfileMenuOpen(false);
    setVaultOpen(true);
    setVaultInfo(null);
    await loadVaultState();
  };

  const handleVaultDeposit = async () => {
    setVaultError(null);
    setVaultInfo(null);
    const amount = Number(vaultAmountCoins);
    if (!Number.isFinite(amount) || amount <= 0) {
      setVaultError("Enter a valid amount");
      return;
    }
    setVaultActionLoading(true);
    try {
      await depositVault(amount, vaultLockDuration);
      setVaultInfo("Balance moved to vault successfully");
      await Promise.all([loadVaultState(), getWallets().then(setWallets)]);
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "Vault deposit failed");
    } finally {
      setVaultActionLoading(false);
    }
  };

  const handleVaultWithdraw = async () => {
    setVaultError(null);
    setVaultInfo(null);
    const amount = Number(vaultAmountCoins);
    if (!Number.isFinite(amount) || amount <= 0) {
      setVaultError("Enter a valid amount");
      return;
    }
    setVaultActionLoading(true);
    try {
      await withdrawVault(amount);
      setVaultInfo("Vault withdraw completed");
      await Promise.all([loadVaultState(), getWallets().then(setWallets)]);
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "Vault withdraw failed");
    } finally {
      setVaultActionLoading(false);
    }
  };

  const availableVaultCoins = vaultState ? Number(atomicToCoinsString(vaultState.availableAtomic, 8)) : 0;

  return (
    <div className="h-screen flex overflow-hidden bg-page">
      {/* Main column — full width */}
      <div className="flex-1 flex min-h-0 flex-col min-w-0">
        {/* Top nav with hamburger */}
        <header className="bg-chrome px-5 py-3 flex items-center shrink-0">
          <div className="flex items-center gap-4 flex-1">
            <div
              onClick={() => setSidebarOpen(!sidebarOpen)}
              style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", width: 48, marginLeft: 0 }}
            >
              <img src="/assets/a1a1cf32be7cd9a4ce48bf4bde0c8d0e.svg" alt="menu" style={{ width: 40, height: 40, opacity: 0.76 }} />
            </div>
            <Link href="/" className="flex items-center gap-2">
              <img src="/assets/7099b46c6cd5928db5dde5a0c11f93e0.svg" alt="logo" className="h-7" />
              <span className="text-lg font-bold tracking-wide text-white" style={{ fontStyle: "italic" }}>REDWATER</span>
            </Link>
          </div>

          <div className="flex items-center gap-6 justify-center">
            <Link href="/wallet" className="group flex items-center gap-2">
              <img src="/assets/73acd855750c13d5a2d86f87a7dd6581.svg" alt="" className="w-[28px] h-[28px]" />
              <span className="text-[14px] font-medium text-[#828282] group-hover:text-white transition-colors">Rewards</span>
            </Link>
            <Link href="/affiliates" className="group flex items-center gap-2">
              <img src="/assets/504f38d3f4b6c086a29a570ab819be73.svg" alt="" className="w-[28px] h-[28px]" />
              <span className="text-[14px] font-medium text-[#828282] group-hover:text-white transition-colors">Affiliates</span>
            </Link>
            <Link
              href="/roulette"
              className="flex h-[46px] items-center gap-2.5 rounded-[12px] bg-gradient-to-r from-[#b57601] to-[#ffc353] px-4"
            >
              <img src="/assets/e7f8abdf0ed47cf60ee551b7bc7251f0.png" alt="" className="h-[42px] w-[42px] object-contain" />
              <div className="leading-tight">
                <p className="m-0 text-[12px] font-bold text-[#382400]">WEEKLY</p>
                <p className="m-0 text-[12px] font-bold text-[#382400]">LEADERBOARD</p>
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-3.5 flex-1 justify-end min-w-0">
            {primaryWallet && (
              <>
                <div className="inline-flex h-[36px] items-center gap-2 rounded-[10px] bg-[#1a1a1a] px-4" style={{ transition: "box-shadow 0.3s", boxShadow: balanceFlash === "up" ? "0 0 12px rgba(34,197,94,0.4)" : balanceFlash === "down" ? "0 0 12px rgba(239,68,68,0.4)" : "none" }}>
                  <span className="inline-flex h-[10px] w-[10px] rounded-full bg-[#f6c453] shadow-[0_0_6px_rgba(246,196,83,0.5)]" />
                  <span style={{
                    fontSize: 14, fontWeight: 600, fontFamily: '"DM Sans","Gotham",sans-serif',
                    color: balanceFlash === "up" ? "#22c55e" : balanceFlash === "down" ? "#ef4444" : "#ffffff",
                    transition: "color 0.3s",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {displayBalance || formatCoins(primaryWallet.balanceCoins, primaryWallet.balanceAtomic)}
                  </span>
                </div>
                <Link
                  href="/deposit"
                  className="inline-flex items-center justify-center text-white transition-all hover:brightness-110"
                  style={{
                    height: 32,
                    paddingLeft: 22,
                    paddingRight: 22,
                    borderRadius: 8,
                    backgroundImage: "linear-gradient(180deg, #f75154 0%, #ac2e30 100%)",
                    boxShadow: "inset 0 1px 0 #f24f51, inset 0 -1px 0 #ff7476",
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: '"DM Sans","Gotham",sans-serif',
                  }}
                >
                  Deposit
                </Link>
                <div className="mx-3 h-[30px] w-px bg-[#2a2a2a]" />
              </>
            )}
            <div ref={profileMenuRef} className="relative flex items-center gap-3.5">
              <div className="flex flex-col items-end gap-0.5">
                <span style={{ fontSize: 13, fontWeight: 600, color: "#ffffff", fontFamily: '"DM Sans","Gotham",sans-serif', lineHeight: "1" }}>{displayUsername}</span>
                <LevelBadge level={Math.max(1, userLevel || 100)} />
              </div>
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen((prev) => !prev);
                  setAvatarError(null);
                  setAvatarInfo(null);
                }}
                className="relative h-[32px] w-[32px] shrink-0 rounded-full"
                title="Open profile options"
              >
                <div className="h-full w-full overflow-hidden rounded-full bg-[#1b1b1b] border border-[#f2cb6a]/45 shadow-[0_0_8px_rgba(242,203,106,0.26)]">
                  {avatarUrlState ? (
                    <img src={avatarUrlState} alt="avatar" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[#202020] text-[13px] font-bold text-white">
                      {avatarInitial}
                    </div>
                  )}
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen((prev) => !prev);
                  setAvatarError(null);
                  setAvatarInfo(null);
                }}
                title="Open profile options"
                style={{ background: "none", border: "none", padding: "0 4px", cursor: "pointer", display: "flex", alignItems: "center" }}
              >
                <img src="/assets/d10470470dfa642abeeb09a45b975af3.svg" alt="menu arrow" className="h-[7px] w-[12px] opacity-60" />
              </button>
              <button
                type="button"
                title="Notifications"
                onClick={() => {
                  const nextOpen = !notifOpen;
                  setNotifOpen(nextOpen);
                  if (nextOpen) {
                    void refreshCashierNotifications();
                  }
                }}
                style={{ background: "none", border: "none", padding: "0 2px", cursor: "pointer", display: "flex", alignItems: "center", marginLeft: 4, position: "relative" }}
              >
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
                  <path fillRule="evenodd" clipRule="evenodd" d="M19.7359 26.4423C20.5578 26.3599 21.1131 27.2323 20.7249 27.9385C20.4513 28.4361 20.0657 28.8705 19.6038 29.2263C19.1327 29.5891 18.5862 29.8675 17.9999 30.0544C17.4134 30.2416 16.7906 30.3363 16.1655 30.3363C15.5405 30.3363 14.9177 30.2416 14.3311 30.0544C13.7449 29.8675 13.1984 29.5891 12.7273 29.2263C12.2654 28.8705 11.8798 28.4361 11.6062 27.9385C11.218 27.2323 11.7733 26.3599 12.5952 26.4423C12.8515 26.468 14.8577 26.6641 16.1655 26.6641C17.4734 26.6641 19.4795 26.468 19.7359 26.4423Z" fill="#828282"/>
                  <path fillRule="evenodd" clipRule="evenodd" d="M11.372 2.7834C14.3909 1.33927 17.9286 1.29014 20.9897 2.64983L21.2633 2.77135C24.4709 4.19609 26.5245 7.28293 26.5245 10.6795V12.364C26.5245 13.718 26.8314 15.0557 27.4241 16.284L27.778 17.0176C29.4033 20.3867 27.2866 24.3247 23.4874 24.9997L23.2733 25.0377C18.5733 25.8728 13.7538 25.8728 9.05388 25.0377C5.20361 24.3537 3.16665 20.2591 5.02981 16.9487L5.33253 16.4109C6.07979 15.0832 6.47109 13.5975 6.47109 12.0879V10.3898C6.47109 7.16587 8.36935 4.21971 11.372 2.7834Z" fill="#828282"/>
                  {hasNewNotif && <circle cx="25" cy="5.5" r="4" fill="#F34950"/>}
                </svg>
              </button>
              {notifOpen && <NotificationsPanel onClose={() => setNotifOpen(false)} onClearBadge={() => { setHasNewNotif(false); localStorage.setItem("notifSeen", "true"); }} />}
              {profileMenuOpen && (
                <div className="absolute right-0 top-[44px] z-50 w-[260px] rounded-[14px] border border-[#1f2a38] bg-[#0b1622] shadow-[0_10px_32px_rgba(0,0,0,0.55)] p-2">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void router.push("/profile");
                    }}
                    className="w-full rounded-[10px] px-3 py-2.5 text-left text-[14px] font-semibold text-[#dce7f7] hover:bg-[#102234] transition-colors"
                  >
                    PROFILE
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void openVaultModal();
                    }}
                    className="w-full rounded-[10px] px-3 py-2.5 text-left text-[14px] font-semibold text-[#dce7f7] hover:bg-[#102234] transition-colors"
                  >
                    VAULT
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void router.push("/affiliates");
                    }}
                    className="w-full rounded-[10px] px-3 py-2.5 text-left text-[14px] font-semibold text-[#dce7f7] hover:bg-[#102234] transition-colors"
                  >
                    AFFILIATES
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void router.push("/transactions");
                    }}
                    className="w-full rounded-[10px] px-3 py-2.5 text-left text-[14px] font-semibold text-[#dce7f7] hover:bg-[#102234] transition-colors"
                  >
                    TRANSACTIONS
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void router.push("/game-history");
                    }}
                    className="w-full rounded-[10px] px-3 py-2.5 text-left text-[14px] font-semibold text-[#dce7f7] hover:bg-[#102234] transition-colors"
                  >
                    GAME HISTORY
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void router.push("/support");
                    }}
                    className="w-full rounded-[10px] px-3 py-2.5 text-left text-[14px] font-semibold text-[#dce7f7] hover:bg-[#102234] transition-colors"
                  >
                    SUPPORT
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      onLogout?.();
                    }}
                    className="w-full rounded-[10px] px-3 py-2.5 text-left text-[14px] font-semibold text-[#ff8d93] hover:bg-[#2a1720] transition-colors"
                  >
                    LOGOUT
                  </button>

                  <div className="mt-2 rounded-[10px] border border-[#223447] bg-[#0c1b2a] p-3">
                    <p className="m-0 text-[11px] uppercase tracking-wide text-[#8ea5bd]">Avatar</p>
                    <p className="m-0 mt-1 text-[11px] text-[#7f95ac]">
                      Set custom avatar URL. If empty, we fallback to provider photo (Google/Steam) or your initial.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-[30px] w-[30px] overflow-hidden rounded-full border border-[#dcb35c]/45 bg-[#1b1b1b]">
                        {avatarUrlState ? (
                          <img src={avatarUrlState} alt="avatar preview" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[12px] font-bold text-white">
                            {avatarInitial}
                          </div>
                        )}
                      </div>
                      <span className="text-[11px] text-[#9cb4cb]">
                        {avatarUrlState ? "Current: image avatar" : `Current: initial (${avatarInitial})`}
                      </span>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input
                        value={avatarInputValue}
                        onChange={(event) => setAvatarInputValue(event.target.value)}
                        placeholder="https://..."
                        className="h-[34px] w-full rounded-[8px] border border-[#2a4258] bg-[#091522] px-2 text-[12px] text-white outline-none"
                      />
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={avatarSaving}
                        onClick={() => void submitAvatarUpdate(avatarInputValue.trim().length > 0 ? avatarInputValue.trim() : null)}
                        className="rounded-[8px] border border-[#f2686a] bg-gradient-to-b from-[#f75a5d] to-[#b73437] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60"
                      >
                        {avatarSaving ? "Saving..." : "Save"}
                      </button>
                      <button
                        type="button"
                        disabled={avatarSaving}
                        onClick={() => void submitAvatarUpdate(null)}
                        className="rounded-[8px] border border-[#35516d] bg-[#0d2234] px-3 py-1.5 text-[12px] font-semibold text-[#c9d7e5] disabled:opacity-60"
                      >
                        Remove custom
                      </button>
                    </div>
                    {avatarError ? <p className="m-0 mt-2 text-[11px] text-[#ff8d93]">{avatarError}</p> : null}
                    {avatarInfo ? <p className="m-0 mt-2 text-[11px] text-[#8df3a1]">{avatarInfo}</p> : null}
                  </div>
                </div>
              )}
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                className="hidden px-6 py-2 rounded-btn bg-panel text-white text-sm font-medium shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424] hover:bg-[#222] transition-colors"
              >
                Sign out
              </button>
            )}
          </div>
        </header>

        {/* Below header: row with [ticker+content] and [chat] */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Sidebar icons — below header */}
          <div style={{
            display: "flex", flexDirection: "column", gap: 6, padding: "8px 8px",
            background: "#0d0d0d", flexShrink: 0,
            width: sidebarOpen ? 200 : 88, transition: "width 0.25s ease",
            overflow: "hidden",
          }}>
            {sideLinks.map((item) => {
              const active = router.pathname === item.href;
              const hovered = hoveredSideHref === item.href;
              const highlighted = active || hovered;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  onMouseEnter={() => setHoveredSideHref(item.href)}
                  onMouseLeave={() => setHoveredSideHref((prev) => (prev === item.href ? null : prev))}
                  style={{
                  display: "flex", alignItems: "center",
                  padding: "0 10px",
                  width: "100%",
                  alignSelf: "stretch",
                  borderRadius: 8, textDecoration: "none",
                  background: active ? "linear-gradient(180deg,#ac2e30,#f75154)" : "transparent",
                  boxShadow: active ? "0 0 10px rgba(247,81,84,0.3)" : hovered ? "0 0 8px rgba(247,81,84,0.18)" : "none",
                  minHeight: sidebarOpen ? 40 : 44,
                  whiteSpace: "nowrap",
                  boxSizing: "border-box",
                  transition: "background 0.2s ease, box-shadow 0.2s ease",
                  position: "relative",
                  overflow: "hidden"
                }}
                >
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 2,
                      height: highlighted ? 22 : 0,
                      borderRadius: 999,
                      background: "#f75154",
                      boxShadow: highlighted ? "0 0 8px rgba(247,81,84,0.55)" : "none",
                      transition: "height 0.2s ease, box-shadow 0.2s ease"
                    }}
                  />
                  <div
                    style={{
                      width: 34,
                      minWidth: 34,
                      height: 34,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      position: "absolute",
                      left: 19
                    }}
                  >
                    <img
                      src={item.src}
                      alt={item.label}
                      style={{
                        width: 34,
                        height: 34,
                        flexShrink: 0,
                        opacity: highlighted ? 1 : 0.74,
                        filter: hovered && !active ? "brightness(1.35) grayscale(1)" : "none",
                        transition: "opacity 0.2s ease, filter 0.2s ease"
                      }}
                    />
                  </div>
                  <span style={{
                    color: highlighted ? "#fff" : "#8f8f8f", fontSize: 13, fontFamily: '"DM Sans",sans-serif', fontWeight: 500,
                    opacity: sidebarOpen ? 1 : 0, transition: "opacity 0.2s ease, max-width 0.25s ease",
                    pointerEvents: sidebarOpen ? "auto" : "none",
                    maxWidth: sidebarOpen ? 120 : 0,
                    overflow: "hidden",
                    marginLeft: 44
                  }}>{item.label}</span>
                </Link>
              );
            })}
          </div>

          {/* Right: ticker + content */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {/* Live ticker */}
            <div className="bg-strip rounded-panel mx-1 my-1 overflow-x-auto shrink-0">
              <div className="flex items-center gap-1.5 py-1.5 px-1.5">
                {(tickerEvents.length > 0 ? tickerEvents : Array.from({ length: 10 })).map((ev, i) => {
                  const win = ev as LiveWinTickerItem | undefined;
                  const modeLabel = win?.modeLabel ?? "Game";
                  const href = win?.route ?? "/";
                  const card = (
                    <div
                      key={i}
                      className="flex items-center gap-2 min-w-[210px] h-[65px] rounded-btn px-3 shrink-0"
                      style={{ background: "linear-gradient(180deg, #161616 0%, #0d0d0d 100%)" }}
                      title={win ? `Mode: ${modeLabel}` : "Waiting for wins..."}
                    >
                      <div className="relative w-[50px] h-[50px] shrink-0 rounded-[8px] overflow-hidden bg-[#111] border border-[#232323] flex items-center justify-center">
                        {win?.skin?.imageUrl ? (
                          <img src={win.skin.imageUrl} alt={win.skin.name} className="w-full h-full object-contain" />
                        ) : (
                          <span className="w-8 h-8 rounded bg-[#1a1a1a]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] text-muted truncate">{win ? win.user.username : "Live wins"}</p>
                        <p className="text-[11px] text-white truncate">
                          {win ? win.skin.name : "Waiting for wins..."}
                        </p>
                        <p className="text-[12px] font-medium text-accent-green">
                          {win?.multiplier ?? "—"}
                        </p>
                      </div>
                    </div>
                  );
                  return (
                    win ? (
                      <Link key={i} href={href} className="no-underline">
                        {card}
                      </Link>
                    ) : (
                      card
                    )
                  );
                })}
              </div>
            </div>

            {/* Page content */}
            <main className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
              {children}
              {!hideFooter ? <Footer /> : null}
            </main>
          </div>

          {/* Right: chat panel */}
          {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
          {!chatOpen && (
            <button
              onClick={() => setChatOpen(true)}
              className="fixed bottom-4 right-4 w-12 h-12 rounded-full bg-accent-red flex items-center justify-center text-white shadow-lg z-50 hover:bg-[#f75154] transition-colors"
            >
              💬
            </button>
          )}
        </div>
      </div>
      {vaultOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-[560px] rounded-[16px] border border-[#2b3746] bg-[#091624] shadow-[0_22px_60px_rgba(0,0,0,0.6)]">
            <div className="flex items-center justify-between border-b border-[#223042] px-5 py-4">
              <div>
                <h2 className="m-0 text-[20px] font-bold text-white">Vault</h2>
                <p className="m-0 mt-1 text-[12px] text-[#89a3bf]">Store your Coins and lock funds up to 7 days</p>
              </div>
              <button
                type="button"
                onClick={() => setVaultOpen(false)}
                className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#0e2335] text-[#9fb6cd] hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              {vaultLoading ? (
                <p className="text-sm text-[#9ab2c8]">Loading vault...</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-[10px] border border-[#213447] bg-[#0b1d2d] p-3">
                      <p className="m-0 text-[11px] uppercase text-[#7f9ab5]">Vault Total</p>
                      <p className="m-0 mt-1 text-[18px] font-bold text-white">
                        {vaultState ? atomicToCoinsString(vaultState.balanceAtomic) : "0.00"}
                      </p>
                    </div>
                    <div className="rounded-[10px] border border-[#213447] bg-[#0b1d2d] p-3">
                      <p className="m-0 text-[11px] uppercase text-[#7f9ab5]">Available</p>
                      <p className="m-0 mt-1 text-[18px] font-bold text-[#7de88f]">
                        {vaultState ? atomicToCoinsString(vaultState.availableAtomic) : "0.00"}
                      </p>
                    </div>
                    <div className="rounded-[10px] border border-[#213447] bg-[#0b1d2d] p-3">
                      <p className="m-0 text-[11px] uppercase text-[#7f9ab5]">Locked</p>
                      <p className="m-0 mt-1 text-[18px] font-bold text-[#ffd28d]">
                        {vaultState ? atomicToCoinsString(vaultState.lockedAtomic) : "0.00"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                    <input
                      value={vaultAmountCoins}
                      onChange={(event) => setVaultAmountCoins(event.target.value)}
                      placeholder="Amount in Coins"
                      className="h-[42px] rounded-[10px] border border-[#233a50] bg-[#0a1b2b] px-3 text-[14px] text-white outline-none focus:border-[#3f5f7a]"
                    />
                    <select
                      value={vaultLockDuration}
                      onChange={(event) => setVaultLockDuration(event.target.value as VaultLockDuration)}
                      className="h-[42px] rounded-[10px] border border-[#233a50] bg-[#0a1b2b] px-3 text-[14px] text-white outline-none"
                    >
                      <option value="1H">Lock 1 hour</option>
                      <option value="1D">Lock 24 hours</option>
                      <option value="3D">Lock 3 days</option>
                      <option value="7D">Lock 7 days</option>
                    </select>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleVaultDeposit()}
                      disabled={vaultActionLoading}
                      className="rounded-btn border border-[#f2686a] bg-gradient-to-b from-[#f75a5d] to-[#b73437] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {vaultActionLoading ? "Processing..." : "Deposit to Vault"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleVaultWithdraw()}
                      disabled={vaultActionLoading || availableVaultCoins <= 0}
                      className="rounded-btn border border-[#2a9f6b] bg-gradient-to-b from-[#2bbf7b] to-[#1a8f5a] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      Withdraw from Vault
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setVaultError(null);
                        setVaultInfo(null);
                        void loadVaultState();
                      }}
                      className="rounded-btn border border-[#35516d] bg-[#0d2234] px-4 py-2 text-sm font-semibold text-[#c9d7e5]"
                    >
                      Refresh
                    </button>
                  </div>

                  {vaultError ? <p className="m-0 text-sm text-[#ff8d93]">{vaultError}</p> : null}
                  {vaultInfo ? <p className="m-0 text-sm text-[#8df3a1]">{vaultInfo}</p> : null}

                  <div className="rounded-[12px] border border-[#213447] bg-[#0a1b2b] p-3">
                    <p className="m-0 mb-2 text-[12px] font-semibold uppercase text-[#8aa4be]">Active locks</p>
                    {!vaultState?.locks?.length ? (
                      <p className="m-0 text-sm text-[#7f97ae]">No active lock right now.</p>
                    ) : (
                      <div className="space-y-2">
                        {vaultState.locks.map((lock) => (
                          <div key={lock.id} className="flex items-center justify-between rounded-[8px] bg-[#0d2134] px-3 py-2">
                            <span className="text-sm font-semibold text-white">{atomicToCoinsString(lock.amountAtomic)} COINS</span>
                            <span className="text-xs text-[#90a8c1]">Unlocks at {new Date(lock.unlockAt).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
