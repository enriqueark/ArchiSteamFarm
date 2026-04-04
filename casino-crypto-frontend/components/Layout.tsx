import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useEffect, useState, useRef } from "react";
import ChatPanel from "./ChatPanel";
import { getWallets, type Wallet } from "@/lib/api";
import { CasinoSocket, type SocketEvent, type RouletteRoundEvent } from "@/lib/socket";

const sideLinks = [
  { href: "/cases", src: "/assets/e2aff152f333aa01b1f9280bef464454.svg", label: "Cases" },
  { href: "/case-battles", src: "/assets/7739c95aea952fc2e80b31e6dd1cf73d.svg", label: "Case Battle" },
  { href: "/roulette", src: "/assets/35ad40f1a702c98648f4437ed2fd02b6.svg", label: "Roulette" },
  { href: "/mines", src: "/assets/50a1a1ae813369ada622b0018ecaa16f.svg", label: "Mines" },
  { href: "#", src: "/assets/90cdff650ad513d6be72c3f0d3a9eea3.svg", label: "Blackjack" },
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
}

export default function Layout({ children, onLogout, userEmail }: Props) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
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
        {sideLinks.map((item) => {
          const active = router.pathname === item.href;
          return (
            <Link
              key={item.label}
              href={item.href}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                width: "100%", padding: sidebarOpen ? "8px 12px" : "0",
                borderRadius: 8, textDecoration: "none",
                background: active ? "#1a1a1a" : "transparent",
                justifyContent: sidebarOpen ? "flex-start" : "center",
              }}
            >
              <img src={item.src} alt={item.label} style={{ width: 42, height: 42, borderRadius: 8, display: "block", flexShrink: 0 }} />
              {sidebarOpen && (
                <span style={{ color: "#fff", fontSize: 14, fontFamily: '"Inter",sans-serif', fontWeight: 500, whiteSpace: "nowrap" }}>
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
        <header className="bg-chrome px-5 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1 hover:opacity-100 opacity-60 transition-opacity">
              <img src="/assets/3df1f4631ccc25f16c81d64ff3af5f46.svg" alt="menu" className="w-6 h-6" />
            </button>
            <Link href="/" className="flex items-center gap-2">
              <img src="/assets/7099b46c6cd5928db5dde5a0c11f93e0.svg" alt="logo" className="h-7" />
              <span className="text-lg font-bold tracking-wide text-white" style={{ fontStyle: "italic" }}>REDWATER</span>
            </Link>
          </div>

          <div className="flex items-center gap-6">
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

          <div className="flex items-center gap-3">
            {primaryWallet && (
              <Link
                href="/wallet"
                className="flex items-center gap-2 px-4 py-2 rounded-btn bg-[#161616] border border-[#252525] hover:border-[#333] transition-colors"
              >
                <span className="text-xs text-muted">COINS</span>
                <span className="text-sm font-medium text-accent-green">
                  {formatCoins(primaryWallet.balanceCoins, primaryWallet.balanceAtomic)}
                </span>
              </Link>
            )}
            <div className="hidden md:flex items-center gap-1">
              <Link
                href="/deposit"
                className="px-3 py-2 rounded-btn text-xs font-semibold bg-[#1a1a1a] text-white border border-[#2a2a2a] hover:bg-[#222] transition-colors"
              >
                Deposit
              </Link>
              <Link
                href="/withdraw"
                className="px-3 py-2 rounded-btn text-xs font-semibold bg-[#1a1a1a] text-white border border-[#2a2a2a] hover:bg-[#222] transition-colors"
              >
                Withdraw
              </Link>
            </div>
            {userEmail && (
              <span className="text-xs text-muted hidden xl:inline">{userEmail}</span>
            )}
            {onLogout && (
              <button
                onClick={onLogout}
                className="px-6 py-2 rounded-btn bg-panel text-white text-sm font-medium shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424] hover:bg-[#222] transition-colors"
              >
                Sign out
              </button>
            )}
          </div>
        </header>

        {/* Live ticker */}
        <div className="bg-strip rounded-panel mx-1 my-1 overflow-hidden">
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

        {/* Content + Chat */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <main className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
            {children}
          </main>
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
