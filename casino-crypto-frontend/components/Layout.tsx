import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useEffect, useState, useRef } from "react";
import ChatPanel from "./ChatPanel";
import Footer from "./Footer";
import { getWallets, type Wallet } from "@/lib/api";
import { CasinoSocket, type SocketEvent, type RouletteRoundEvent } from "@/lib/socket";

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
  if (balanceCoins && Number.isFinite(Number(balanceCoins))) {
    return Number(balanceCoins).toFixed(2);
  }
  if (balanceAtomic) {
    return formatAtomic(balanceAtomic, 8);
  }
  return "0.00";
}

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
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [tickerEvents, setTickerEvents] = useState<RouletteRoundEvent[]>([]);
  const socketRef = useRef<CasinoSocket | null>(null);

  useEffect(() => {
    getWallets().then(setWallets).catch(() => {});
    const interval = setInterval(() => {
      getWallets().then(setWallets).catch(() => {});
    }, 15_000);
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

  const primaryWallet = wallets.find((w) => w.currency === "COINS") || wallets[0];

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
              <img src="/assets/7099b46c6cd5928db5dde5a0c11f93e0.svg" alt="logo" className="h-7" />
              <span className="text-lg font-bold tracking-wide text-white" style={{ fontStyle: "italic" }}>REDWATER</span>
            </Link>
          </div>

          <div className="flex items-center gap-6 justify-center">
            <Link href="/wallet" className="flex items-center gap-2 text-sm text-muted hover:text-white transition-colors">
              <img src="/assets/9c5bb018d55a11c0b094ee2c9833d52f.svg" alt="" className="w-5 h-5" />
              <span>Rewards</span>
            </Link>
            <Link href="/cases" className="flex items-center gap-2 text-sm text-muted hover:text-white transition-colors">
              <img src="/assets/83d81222ca9a94fcdf1e086fa398eed1.svg" alt="" className="w-5 h-5" />
              <span>Affiliates</span>
            </Link>
            <Link href="/roulette" className="flex items-center gap-2 bg-gradient-to-r from-[#b57601] to-[#ffc353] rounded-btn px-4 py-2 cursor-pointer">
              <img src="/assets/d9129866945bfa6765d5ea9981de3f1c.png" alt="" className="w-8 h-8" />
              <div className="leading-tight">
                <p className="text-xs font-bold text-[#382400]">WEEKLY</p>
                <p className="text-xs font-bold text-[#382400]">LEADERBOARD</p>
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-2 flex-1 justify-end">
            {primaryWallet && (
              <>
                <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-btn bg-[#121212] border border-[#2a2a2a] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                  <span className="inline-block h-[8px] w-[8px] rounded-full bg-[#f6c453] shadow-[0_0_8px_rgba(246,196,83,0.65)]" />
                  <span className="text-sm font-semibold text-white">
                    {formatCoins(primaryWallet.balanceCoins, primaryWallet.balanceAtomic)}
                  </span>
                </div>
                <Link
                  href="/deposit"
                  className="px-4 py-2 rounded-btn text-xs font-semibold bg-gradient-to-b from-[#f75a5d] to-[#b73437] text-white border border-[#f2686a] hover:brightness-105 transition-all"
                >
                  Deposit
                </Link>
              </>
            )}
            <div className="hidden xl:flex items-center gap-2 rounded-btn bg-[#111111] border border-[#232323] px-2 py-1.5">
              <div className="min-w-0 max-w-[120px]">
                <p className="m-0 truncate text-[13px] font-semibold text-white leading-[13px]">
                  {(userEmail?.split("@")[0] || "WildHub").slice(0, 16)}
                </p>
                <div className="mt-[3px] inline-flex h-[14px] min-w-[20px] items-center justify-center rounded-full bg-[#1b1b1b] border border-[#3a3a3a] px-[4px]">
                  <span className="text-[9px] leading-[9px] font-bold text-[#f2cb6a]">
                    {Math.max(1, userLevel || 80)}
                  </span>
                </div>
              </div>
              <div className="relative h-[32px] w-[32px] shrink-0">
                <div className="absolute inset-0 rounded-full border border-[#f2cb6a]/40 shadow-[0_0_8px_rgba(242,203,106,0.3)]" />
                <div className="h-full w-full overflow-hidden rounded-full bg-[#1b1b1b]">
                  {userAvatarUrl ? (
                    <img src={userAvatarUrl} alt="avatar" className="h-full w-full object-cover" />
                  ) : (
                    <img
                      src="/assets head/69a77514d4212f89fc13bd58f30d7dcf.png"
                      alt="avatar"
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <span className="absolute right-[-1px] top-[-1px] h-[8px] w-[8px] rounded-full border border-[#101010] bg-[#f34950]" />
              </div>
              <button
                type="button"
                className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full bg-transparent"
                title="Open profile options"
              >
                <img src="/assets head/d10470470dfa642abeeb09a45b975af3.svg" alt="menu arrow" className="w-[14px] h-[8px]" />
              </button>
              <button
                type="button"
                className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-full bg-transparent"
                title="Notifications"
              >
                <img src="/assets head/1b3ec61d438ea6f94b5e896ae009580a.svg" alt="notifications" className="w-[32px] h-[32px]" />
              </button>
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
    </div>
  );
}
