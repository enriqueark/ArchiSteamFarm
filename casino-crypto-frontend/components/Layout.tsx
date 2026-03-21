import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode } from "react";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/wallet", label: "Wallet" },
  { href: "/roulette", label: "Roulette" },
  { href: "/mines", label: "Mines" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center gap-6">
        <span className="font-bold text-indigo-400 text-lg mr-4">Crypto Casino</span>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`text-sm transition-colors ${
              router.pathname === l.href
                ? "text-indigo-400 font-medium"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">{children}</main>
    </div>
  );
}
