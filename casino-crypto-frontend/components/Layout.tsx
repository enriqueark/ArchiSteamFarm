import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useEffect, useRef, useState } from "react";
import ChatPanel from "./ChatPanel";
import Footer from "./Footer";
import {
  depositVault,
  getVaultState,
  getWallets,
  type VaultLockDuration,
  type VaultState,
  type Wallet,
  withdrawVault
} from "@/lib/api";
import { CasinoSocket, type SocketEvent, type RouletteRoundEvent } from "@/lib/socket";

const sideLinks = [
  { href: "/cases", src: "/assets/e2aff152f333aa01b1f9280bef464454.svg", label: "Cases" },
  { href: "/case-battles", src: "/assets/7739c95aea952fc2e80b31e6dd1cf73d.svg", label: "Case Battle" },
  { href: "/roulette", src: "/assets/35ad40f1a702c98648f4437ed2fd02b6.svg", label: "Roulette" },
  { href: "/mines", src: "/assets/8ffba4817b8664c5480ee873923615b0.svg", label: "Mines" },
  { href: "/blackjack", src: "/assets/90cdff650ad513d6be72c3f0d3a9eea3.svg", label: "Blackjack" },
];

const COIN_ICON_SRC = "/assets/69a77514d4212f89fc13bd58f30d7dcf.png";
type BalanceTrend = "up" | "down" | null;

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
function parseCoins(balanceCoins?: string, balanceAtomic?: string): number {
  if (balanceCoins && Number.isFinite(Number(balanceCoins))) {
    return Number(balanceCoins);
  }
  if (balanceAtomic) {
    const atomicNumber = Number(balanceAtomic);
    if (Number.isFinite(atomicNumber)) {
      return atomicNumber / Math.pow(10, 8);
    }
  }
  return 0;
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
}

export default function Layout({ children, onLogout, userEmail, userLevel, userAvatarUrl }: Props) {
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
  const [displayBalance, setDisplayBalance] = useState(0);
  const [targetBalance, setTargetBalance] = useState(0);
  const [balanceTrend, setBalanceTrend] = useState<BalanceTrend>(null);
  const [trendPulse, setTrendPulse] = useState(0);
  const [tickerEvents, setTickerEvents] = useState<RouletteRoundEvent[]>([]);
  const socketRef = useRef<CasinoSocket | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const previousBalanceRef = useRef<number | null>(null);
  const displayBalanceRef = useRef(0);
  const balanceAnimationFrameRef = useRef<number | null>(null);
  const trendResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getWallets().then(setWallets).catch(() => {});
    const interval = setInterval(() => {
      getWallets().then(setWallets).catch(() => {});
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const sock = new CasinoSocket("USDT");
    socketRef.current = sock;
    sock.subscribe((ev: SocketEvent) => {
      if (ev.type === "roulette.round" && ev.data.status === "SETTLED" && ev.data.winningNumber !== null) {
        setTickerEvents((prev) => [ev.data, ...prev].slice(0, 20));
      }
    });
    sock.connect();
    return () => sock.disconnect();
  }, []);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!profileMenuRef.current) return;
      const target = event.target as Node | null;
      if (target && !profileMenuRef.current.contains(target)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    setProfileMenuOpen(false);
  }, [router.pathname]);

  const primaryWallet = wallets.find((w) => w.currency === "COINS") || wallets[0];
  useEffect(() => {
    const nextBalance = parseCoins(primaryWallet?.balanceCoins, primaryWallet?.balanceAtomic);
    setTargetBalance(nextBalance);
    const previous = previousBalanceRef.current;
    if (previous !== null) {
      const delta = nextBalance - previous;
      if (Math.abs(delta) > 0.0000001) {
        setBalanceTrend(delta > 0 ? "up" : "down");
        setTrendPulse((prev) => prev + 1);
        if (trendResetTimerRef.current !== null) {
          clearTimeout(trendResetTimerRef.current);
        }
        trendResetTimerRef.current = setTimeout(() => {
          setBalanceTrend(null);
          trendResetTimerRef.current = null;
        }, 1100);
      }
    }
    previousBalanceRef.current = nextBalance;
  }, [primaryWallet?.balanceAtomic, primaryWallet?.balanceCoins]);
  useEffect(() => {
    if (balanceAnimationFrameRef.current !== null) {
      cancelAnimationFrame(balanceAnimationFrameRef.current);
      balanceAnimationFrameRef.current = null;
    }
    const start = displayBalanceRef.current;
    const end = targetBalance;
    const durationMs = 900;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const progress = Math.max(0, Math.min(1, elapsed / durationMs));
      const eased = 1 - (1 - progress) ** 3;
      const next = start + (end - start) * eased;
      displayBalanceRef.current = next;
      setDisplayBalance(next);
      if (progress < 1) {
        balanceAnimationFrameRef.current = requestAnimationFrame(tick);
      } else {
        displayBalanceRef.current = end;
        setDisplayBalance(end);
        balanceAnimationFrameRef.current = null;
      }
    };
    balanceAnimationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (balanceAnimationFrameRef.current !== null) {
        cancelAnimationFrame(balanceAnimationFrameRef.current);
        balanceAnimationFrameRef.current = null;
      }
    };
  }, [targetBalance]);
  useEffect(() => {
    return () => {
      if (trendResetTimerRef.current !== null) {
        clearTimeout(trendResetTimerRef.current);
        trendResetTimerRef.current = null;
      }
      if (balanceAnimationFrameRef.current !== null) {
        cancelAnimationFrame(balanceAnimationFrameRef.current);
        balanceAnimationFrameRef.current = null;
      }
    };
  }, []);
  const balancePulseClass = balanceTrend
    ? `wallet-balance-${balanceTrend}-${trendPulse % 2 === 0 ? "a" : "b"}`
    : "";
  const balanceAmountClass = balanceTrend ? `wallet-balance-amount-${balanceTrend}` : "";
  const displayUsername = (userEmail?.split("@")[0] || "WildHub").slice(0, 16);

  const refreshWallets = () => {
    getWallets().then(setWallets).catch(() => {});
  };

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
      {/* Left sidebar */}
      <aside
        style={{
          display: "flex", flexDirection: "column", gap: 6, padding: 10,
          background: "#0d0d0d", borderRadius: 18, flexShrink: 0,
          width: sidebarOpen ? 220 : 62, transition: "width 0.2s",
          overflow: "hidden", alignItems: "flex-start",
        }}
      >
        {/* Hamburger toggle — top of sidebar */}
        <div
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{ display: "flex", alignItems: "center", justifyContent: sidebarOpen ? "flex-start" : "center", width: "100%", cursor: "pointer", marginBottom: 6 }}
        >
          <img src="/assets/a1a1cf32be7cd9a4ce48bf4bde0c8d0e.svg" alt="menu" style={{ width: 42, height: 42, borderRadius: 8 }} />
        </div>
        {sideLinks.map((item) => {
          const active = router.pathname === item.href;
          const hovered = hoveredSideHref === item.href;
          const highlighted = active || hovered;
          const background = active
            ? "linear-gradient(180deg, #ac2e30 0%, #f75154 100%)"
            : hovered
              ? "linear-gradient(180deg, #7e2b2e 0%, #bf4246 100%)"
              : "transparent";
          const boxShadow = active
            ? "0 0 14px rgba(247,81,84,0.35)"
            : hovered
              ? "0 0 10px rgba(247,81,84,0.18)"
              : "none";
          return (
            <Link
              key={item.label}
              href={item.href}
              onMouseEnter={() => setHoveredSideHref(item.href)}
              onMouseLeave={() => setHoveredSideHref((prev) => (prev === item.href ? null : prev))}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                width: "100%", padding: sidebarOpen ? "8px 12px" : "0",
                borderRadius: 8, textDecoration: "none",
                background,
                boxShadow,
                justifyContent: sidebarOpen ? "flex-start" : "center",
                transition: "background 160ms ease, box-shadow 160ms ease, transform 160ms ease",
                transform: active ? "translateX(1px)" : hovered ? "translateX(0.5px)" : "translateX(0)"
              }}
            >
              <img
                src={item.src}
                alt={item.label}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 0,
                  display: "block",
                  flexShrink: 0,
                  opacity: highlighted ? 1 : 0.74,
                  transition: "opacity 160ms ease"
                }}
              />
              {sidebarOpen && (
                <span
                  style={{
                    color: highlighted ? "#fff" : "#8f8f8f",
                    fontSize: 14,
                    fontFamily: '"Inter",sans-serif',
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    transition: "color 160ms ease"
                  }}
                >
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
      </aside>

      {/* Main column */}
      <div className="flex-1 flex min-h-0 flex-col min-w-0">
        {/* Top nav */}
        <header className="bg-chrome px-5 py-3 flex items-center shrink-0">
          <div className="flex items-center gap-4 flex-1">
            <Link href="/" className="flex items-center gap-2">
              <img src="/assets/dinoskins-logo.png" alt="DINOSKINS logo" className="h-9 w-auto object-contain" />
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
                <div className={`inline-flex h-[36px] items-center gap-2 rounded-[10px] bg-[#1a1a1a] px-4 ${balancePulseClass}`}>
                  <img src={COIN_ICON_SRC} alt="" className="h-[14px] w-[14px] shrink-0 object-contain" />
                  <span
                    className={balanceAmountClass}
                    style={{ fontSize: 14, fontWeight: 600, color: "#ffffff", fontFamily: '"DM Sans","Gotham",sans-serif' }}
                  >
                    {formatCoins(String(displayBalance))}
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
                <span className="inline-flex h-[18px] min-w-[24px] items-center justify-center rounded-[5px] bg-gradient-to-b from-[#3c5e7c] to-[#2a415b] px-1.5 text-[10px] font-bold leading-none text-[#d8ecff]">
                  {Math.max(1, userLevel || 80)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setProfileMenuOpen((prev) => !prev)}
                className="relative h-[32px] w-[32px] shrink-0 rounded-full"
                title="Open profile options"
              >
                <div className="h-full w-full overflow-hidden rounded-full bg-[#1b1b1b]">
                  {userAvatarUrl ? (
                    <img src={userAvatarUrl} alt="avatar" className="h-full w-full object-cover" />
                  ) : (
                    <img
                      src="/assets/69a77514d4212f89fc13bd58f30d7dcf.png"
                      alt="avatar"
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
              </button>
              <button
                type="button"
                onClick={() => setProfileMenuOpen((prev) => !prev)}
                title="Open profile options"
                style={{ background: "none", border: "none", padding: "0 4px", cursor: "pointer", display: "flex", alignItems: "center" }}
              >
                <img src="/assets/d10470470dfa642abeeb09a45b975af3.svg" alt="menu arrow" className="h-[7px] w-[12px] opacity-60" />
              </button>
              <button
                type="button"
                title="Notifications"
                style={{ background: "none", border: "none", padding: "0 2px", cursor: "pointer", display: "flex", alignItems: "center", marginLeft: 4 }}
              >
                <img src="/assets/1b3ec61d438ea6f94b5e896ae009580a.svg" alt="notifications" className="h-[24px] w-[24px]" />
              </button>
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
          {/* Left: ticker + content */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {/* Live ticker */}
            <div className="bg-strip rounded-panel mx-1 my-1 overflow-hidden shrink-0">
              <div className={`flex items-center gap-1.5 py-1.5 px-1.5 ${tickerEvents.length > 5 ? "ticker-scroll" : ""}`}>
                {(tickerEvents.length > 0 ? [...tickerEvents, ...tickerEvents] : Array.from({ length: 10 })).map((ev, i) => {
                  const round = ev as RouletteRoundEvent | undefined;
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 min-w-[189px] h-[65px] rounded-btn px-3 shrink-0"
                      style={{ background: "linear-gradient(180deg, #161616 0%, #0d0d0d 100%)" }}
                    >
                      <div className="relative w-[50px] h-[50px] shrink-0 flex items-center justify-center">
                        <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-[32px] rounded-r ${
                          round?.winningColor === "RED" ? "bg-red-500" : round?.winningColor === "BLACK" ? "bg-gray-400" : round?.winningColor === "GREEN" ? "bg-green-500" : "bg-accent-red"
                        }`} />
                        {round ? (
                          <span className={`text-2xl font-bold ${
                            round.winningColor === "RED" ? "text-red-400" : round.winningColor === "GREEN" ? "text-green-400" : "text-white"
                          }`}>
                            {round.winningNumber}
                          </span>
                        ) : (
                          <span className="w-8 h-8 rounded bg-[#1a1a1a]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] text-muted truncate">Roulette</p>
                        <p className="text-[11px] text-white truncate">
                          {round ? `Round #${round.roundNumber}` : "Waiting..."}
                        </p>
                        <p className="text-[12px] font-medium text-accent-green">
                          {round ? `${round.currency}` : "—"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Page content */}
            <main className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
              {children}
              <Footer />
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
