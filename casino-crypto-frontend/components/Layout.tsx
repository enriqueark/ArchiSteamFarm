import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/Button";
import BalanceControl from "@/components/BalanceControl";
import { getMe, logout, type User } from "@/lib/api";
import { useAuthUI } from "@/lib/auth-ui";

const tickerItems = [
  { name: "Glock-18 Fully Tuned", price: "$372.40" },
  { name: "AK-47 Crane Flight", price: "$173.20" },
  { name: "Sport Gloves Occult", price: "$6,272.40" },
  { name: "Glock-18 Fully Tuned", price: "$5.50" },
  { name: "Glock-18 Fully Tuned", price: "$0.07" },
  { name: "Glock-18 Fully Tuned", price: "$372.40" }
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
    <div className="min-h-screen flex flex-col bg-[#06070b] text-white">
      <header className="sticky top-0 z-30 border-b border-[#131720] bg-[#0b0d13]">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#1f2533] bg-[#0f131c] text-gray-300"
            >
              ☰
            </button>
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-wide">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded bg-red-600/20 text-red-400">◆</span>
              <span className="text-2xl italic font-black text-white">REDWATER</span>
            </Link>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <button className="rounded-full bg-[#161a23] px-3 py-1.5 text-xs text-gray-300">Rewards</button>
            <button className="rounded-full bg-[#161a23] px-3 py-1.5 text-xs text-gray-300">Affiliates</button>
            <button className="rounded-lg bg-[#e5b445] px-3 py-1.5 text-xs font-bold text-[#332106]">WEEKLY LEADERBOARD</button>
          </div>

          <div className="flex items-center gap-2">
            {authed ? <BalanceControl /> : null}
            {authed ? (
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((prev) => !prev)}
                  className="flex min-w-[190px] items-center gap-3 rounded-md bg-[#1a1f2b] px-3 py-1.5 text-left transition-colors hover:bg-[#262c3a]"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#d9dbf6] text-xs font-bold text-gray-700">
                    {displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex flex-1 items-center gap-2 truncate text-sm font-semibold text-white">
                    <span className="truncate">{displayName}</span>
                    <span className="shrink-0 rounded bg-indigo-900/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-200">
                      LVL {user?.progression?.level ?? 1}
                    </span>
                  </span>
                </button>

                {menuOpen && (
                  <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-[220px] overflow-hidden rounded-md border border-[#30374a] bg-[#1c2230] shadow-[0_14px_40px_rgba(0,0,0,0.35)]">
                    {[
                      { label: "Profile", href: "/profile" },
                      { label: "Affiliates", href: "/affiliates" },
                      { label: "Support", href: "/support" },
                      { label: "Fairness", href: "/fairness" },
                      { label: "Leaderboard", href: "/leaderboard" },
                      { label: "FAQ", href: "/faq" },
                      { label: "Terms", href: "/terms" }
                    ].map((item) => (
                      <button
                        key={item.href}
                        type="button"
                        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-white transition-colors hover:bg-[#2a3245]"
                        onClick={() => {
                          setMenuOpen(false);
                          void router.push(item.href);
                        }}
                      >
                        <span>{item.label}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-white transition-colors hover:bg-[#2a3245]"
                      onClick={() => void handleLogout()}
                    >
                      <span>Log Out</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Button
                  variant="secondary"
                  className="rounded-md border border-[#2a3041] bg-[#141925] px-5 py-2 text-white hover:bg-[#1e2431]"
                  onClick={() => openAuth("login")}
                >
                  Sign in
                </Button>
                <Button
                  className="rounded-md bg-[#ef4444] px-5 py-2 text-white hover:bg-[#f05252]"
                  onClick={() => openAuth("register")}
                >
                  Sign Up
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="border-t border-[#131720] px-3 py-2">
          <div className="flex items-center gap-2 overflow-x-auto">
            {tickerItems.map((item, index) => (
              <div
                key={`${item.name}-${index}`}
                className="min-w-[154px] rounded border border-[#1e2433] bg-[#0f131d] px-2 py-1.5 text-[10px] text-gray-300"
              >
                <p className="truncate text-[9px] text-gray-500">{item.name}</p>
                <p className="truncate font-semibold text-green-300">{item.price}</p>
              </div>
            ))}
            <button
              type="button"
              className="ml-auto h-8 min-w-8 rounded bg-[#ef4444] text-sm font-semibold text-white"
              onClick={() => void router.push("/cases")}
            >
              ›
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 w-full px-3 pb-8 pt-3 lg:pr-[300px]">{children}</main>
    </div>
  );
}
