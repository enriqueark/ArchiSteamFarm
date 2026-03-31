import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/Button";
import BalanceControl from "@/components/BalanceControl";
import { getMe, logout, type User } from "@/lib/api";
import { useAuthUI } from "@/lib/auth-ui";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/roulette", label: "Roulette" },
  { href: "/blackjack", label: "Blackjack" },
  { href: "/battles", label: "Battles" },
  { href: "/cases", label: "Cases" },
  { href: "/mines", label: "Mines" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/faq", label: "FAQ" },
  { href: "/terms", label: "Terms" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { authed, openAuth, setAuthed } = useAuthUI();
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const displayName = useMemo(() => {
    if (!user?.email) {
      return "Player";
    }
    const [localPart] = user.email.split("@");
    return localPart || "Player";
  }, [user?.email]);

  useEffect(() => {
    if (!authed) {
      setUser(null);
      return;
    }
    let cancelled = false;
    getMe()
      .then((me) => {
        if (!cancelled) {
          setUser(me);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authed]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutsideClick);
    return () => {
      document.removeEventListener("mousedown", onOutsideClick);
    };
  }, [menuOpen]);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // ignore
    }
    setMenuOpen(false);
    setAuthed(false);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center gap-4">
        <div className="flex flex-1 items-center gap-6">
          <span className="font-bold text-red-400 text-lg mr-4">Crypto Casino</span>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`text-sm transition-colors ${
                router.pathname === l.href
                  ? "text-red-400 font-medium"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex shrink-0 items-center justify-center">{authed ? <BalanceControl /> : null}</div>
        <div className="flex flex-1 items-center justify-end gap-2">
          {authed ? (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                className="flex min-w-[210px] items-center gap-3 rounded-lg bg-[#3c3f5f] px-3 py-2 text-left transition-colors hover:bg-[#4a4e72]"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#d9dbf6] text-xs font-bold text-gray-700">
                  {displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="flex flex-1 items-center gap-2 truncate text-sm font-semibold text-white">
                  <span className="truncate">{displayName}</span>
                  <span className="shrink-0 rounded bg-indigo-900/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-200">
                    LVL {user?.progression?.level ?? 1}
                  </span>
                </span>
                <span className={`text-xs text-gray-300 transition-transform ${menuOpen ? "rotate-180" : ""}`}>⌃</span>
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-[240px] overflow-hidden rounded-xl border border-[#4a4e72] bg-[#3c3f5f] shadow-[0_14px_40px_rgba(0,0,0,0.35)]">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-white transition-colors hover:bg-[#4a4e72]"
                    onClick={() => {
                      setMenuOpen(false);
                      void router.push("/profile");
                    }}
                  >
                    <span className="text-base text-gray-300">👤</span>
                    <span>Profile</span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-white transition-colors hover:bg-[#4a4e72]"
                    onClick={() => {
                      setMenuOpen(false);
                      void router.push("/affiliates");
                    }}
                  >
                    <span className="text-base text-gray-300">👥</span>
                    <span>Affiliates</span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-white transition-colors hover:bg-[#4a4e72]"
                    onClick={() => {
                      setMenuOpen(false);
                      void router.push("/support");
                    }}
                  >
                    <span className="text-base text-gray-300">↪</span>
                    <span>Support</span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-white transition-colors hover:bg-[#4a4e72]"
                    onClick={() => {
                      setMenuOpen(false);
                      void router.push("/fairness");
                    }}
                  >
                    <span className="text-base text-gray-300">🛡</span>
                    <span>Fairness</span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-white transition-colors hover:bg-[#4a4e72]"
                    onClick={() => void handleLogout()}
                  >
                    <span className="text-base text-gray-300">↩</span>
                    <span>Log Out</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Button variant="secondary" className="px-5 py-2" onClick={() => openAuth("login")}>
                Sign in
              </Button>
              <Button
                className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
                onClick={() => openAuth("register")}
              >
                Sign up
              </Button>
            </>
          )}
        </div>
      </nav>
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">{children}</main>
    </div>
  );
}
