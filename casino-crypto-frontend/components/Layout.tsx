import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useState } from "react";
import ChatPanel from "./ChatPanel";

const sideLinks = [
  { href: "/", icon: "🏠", label: "Home" },
  { href: "/roulette", icon: "🎰", label: "Roulette" },
  { href: "/mines", icon: "💣", label: "Mines" },
  { href: "/wallet", icon: "💰", label: "Wallet" },
];

const topLinks = [
  { href: "#", label: "Rewards", icon: "⭐" },
  { href: "#", label: "Affiliates", icon: "👥" },
];

interface Props {
  children: ReactNode;
  onLogout?: () => void;
  userEmail?: string;
}

export default function Layout({ children, onLogout, userEmail }: Props) {
  const router = useRouter();
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-surface">
      {/* Sidebar */}
      <aside className="w-16 bg-surface-100 border-r border-border flex flex-col items-center py-4 gap-2 shrink-0">
        <div className="mb-4">
          <div className="w-10 h-10 rounded-lg bg-brand flex items-center justify-center text-white font-bold text-sm">
            R
          </div>
        </div>
        {sideLinks.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            title={l.label}
            className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all ${
              router.pathname === l.href
                ? "bg-surface-300 text-white"
                : "text-gray-500 hover:bg-surface-200 hover:text-gray-300"
            }`}
          >
            {l.icon}
          </Link>
        ))}
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top navigation */}
        <header className="h-14 bg-surface-100 border-b border-border px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-extrabold text-lg tracking-tight">
              <span className="text-brand">RED</span>
              <span className="text-white">WATER</span>
            </Link>
            {topLinks.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="hidden md:flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
              >
                <span>{l.icon}</span>
                <span>{l.label}</span>
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-300 text-sm text-gray-300 hover:bg-surface-400 transition-colors"
            >
              💬 <span className="hidden sm:inline">Chat</span>
            </button>
            {userEmail && (
              <span className="text-xs text-gray-500 hidden md:inline">{userEmail}</span>
            )}
            {onLogout && (
              <button
                onClick={onLogout}
                className="px-3 py-1.5 rounded-lg bg-surface-300 text-sm text-gray-400 hover:text-white hover:bg-surface-400 transition-colors"
              >
                Sign out
              </button>
            )}
          </div>
        </header>

        {/* Ticker bar */}
        <div className="h-10 bg-surface-200 border-b border-border overflow-hidden flex items-center">
          <div className="ticker-scroll flex items-center gap-6 whitespace-nowrap px-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <span key={i} className="flex items-center gap-2 text-xs">
                <span className="w-6 h-6 rounded bg-surface-300" />
                <span className="text-gray-500">Item #{i + 1}</span>
                <span className="text-green-400 font-medium">${(Math.random() * 500 + 5).toFixed(2)}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Content + Chat */}
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
          {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
        </div>
      </div>
    </div>
  );
}
