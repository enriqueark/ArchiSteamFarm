import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode } from "react";
import Button from "@/components/Button";
import { logout } from "@/lib/api";
import { useAuthUI } from "@/lib/auth-ui";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/wallet", label: "Wallet" },
  { href: "/roulette", label: "Roulette" },
  { href: "/mines", label: "Mines" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { authed, openAuth, setAuthed } = useAuthUI();

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // ignore
    }
    setAuthed(false);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
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
        <div className="flex items-center gap-2">
          {authed ? (
            <Button variant="secondary" className="px-5 py-2" onClick={() => void handleLogout()}>
              Logout
            </Button>
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
