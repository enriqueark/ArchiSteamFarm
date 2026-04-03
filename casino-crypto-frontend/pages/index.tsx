import Link from "next/link";

const games = [
  { name: "CASES", href: "#", color: "from-red-900/40 to-red-950/60", icon: "📦" },
  { name: "CASE BATTLE", href: "#", color: "from-red-900/40 to-red-950/60", icon: "⚔️" },
  { name: "ROULETTE", href: "/roulette", color: "from-red-900/40 to-red-950/60", icon: "🎰" },
  { name: "MINES", href: "/mines", color: "from-red-900/40 to-red-950/60", icon: "💣" },
  { name: "BLACKJACK", href: "#", color: "from-red-900/40 to-red-950/60", icon: "🃏" },
];

const highlights = [
  { game: "Roulette", player: "WildHub", amount: "1.00", multi: "0.00x", payout: "0.00" },
  { game: "Roulette", player: "WildHub", amount: "1.00", multi: "0.00x", payout: "0.00" },
  { game: "Roulette", player: "WildHub", amount: "1.00", multi: "0.00x", payout: "0.00" },
  { game: "Roulette", player: "WildHub", amount: "1.00", multi: "0.00x", payout: "0.00" },
  { game: "Roulette", player: "WildHub", amount: "1.00", multi: "0.00x", payout: "0.00" },
  { game: "Roulette", player: "WildHub", amount: "1.00", multi: "0.00x", payout: "0.00" },
];

const footerLinks = {
  Games: ["Cases", "Case Battles", "Roulette", "Mines", "BlackJack"],
  Platform: ["Rewards", "Affiliates", "Blog", "Support", "FAQ", "Partnerships"],
  "About us": ["Terms of Service", "Privacy Policy", "AML Policy", "Cookies Policy", "Self-Exclusion", "Fairness"],
  Community: ["Twitter", "Discord", "Telegram", "Kick"],
};

export default function HomePage() {
  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Banners */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="h-40 rounded-xl bg-gradient-to-br from-surface-300 to-surface-200 border border-border flex items-center justify-center">
          <span className="text-2xl font-bold text-gray-600">BANNER 1</span>
        </div>
        <div className="h-40 rounded-xl bg-gradient-to-br from-surface-300 to-surface-200 border border-border flex items-center justify-center">
          <span className="text-2xl font-bold text-gray-600">BANNER 2</span>
        </div>
      </div>

      {/* Games section */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-brand text-lg">🎮</span>
          <h2 className="text-xl font-bold text-white">Games</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {games.map((g) => (
            <Link
              key={g.name}
              href={g.href}
              className="group relative rounded-xl overflow-hidden border border-border hover:border-brand/40 transition-all"
            >
              <div className={`aspect-[4/5] bg-gradient-to-b ${g.color} flex flex-col items-center justify-center gap-3 p-4`}>
                <span className="text-5xl group-hover:scale-110 transition-transform">{g.icon}</span>
              </div>
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-brand text-xs">●</span>
                  <span className="text-sm font-semibold text-white">{g.name}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Highlights */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-brand text-lg">🔥</span>
            <h2 className="text-xl font-bold text-white">Highlights</h2>
          </div>
          <Link href="#" className="text-sm text-gray-400 hover:text-white transition-colors">
            View All
          </Link>
        </div>

        <div className="flex gap-2 mb-4">
          {["All Games", "Big wins", "My Games"].map((tab, i) => (
            <button
              key={tab}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                i === 0
                  ? "bg-surface-300 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="bg-surface-100 rounded-xl border border-border overflow-hidden">
          <div className="grid grid-cols-5 gap-4 px-4 py-3 text-xs font-medium text-gray-500 border-b border-border">
            <span>Game</span>
            <span>Player</span>
            <span>Amount</span>
            <span>Multi</span>
            <span>Payout</span>
          </div>
          {highlights.map((h, i) => (
            <div
              key={i}
              className="grid grid-cols-5 gap-4 px-4 py-3 text-sm border-b border-border last:border-b-0 hover:bg-surface-200/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-brand text-xs">●</span>
                <span className="text-gray-300">{h.game}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-surface-300 flex items-center justify-center text-[10px] font-bold text-gray-400">
                  W
                </span>
                <span className="text-white font-medium">{h.player}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-orange-500/20" />
                <span className="text-gray-300">{h.amount}</span>
              </div>
              <span className="text-gray-400 self-center">{h.multi}</span>
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-orange-500/20" />
                <span className="text-gray-300">{h.payout}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border pt-8 pb-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2 md:col-span-1">
            <div className="font-extrabold text-lg mb-3">
              <span className="text-brand">RED</span>
              <span className="text-white">WATER</span>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              &copy; All rights reserved 2026
            </p>
            <p className="text-[10px] text-gray-700 mt-2 leading-relaxed">
              Operated by Innospace LTD, Organization number 646564, Voukourestiou, 25 Neptune House, 1st Floor, Office 11, Zakaki, 3045, Limassol, Cyprus.
            </p>
            <div className="mt-3 space-y-1 text-[10px] text-gray-600">
              <p>Support: support@redwater.gg</p>
              <p>Partners: partners@redwater.gg</p>
            </div>
            <p className="mt-3 text-[10px] text-gray-700 flex items-center gap-1">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-brand/20 text-brand text-[9px] font-bold">18+</span>
              By accessing this site, you confirm that you are over 18 years old.
            </p>
          </div>
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
              <ul className="space-y-2">
                {links.map((l) => (
                  <li key={l}>
                    <Link href="#" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                      {l}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 pt-4 border-t border-border flex flex-wrap gap-3">
          {["VISA", "MC", "GPay", "ApplePay", "BTC", "ETH", "USDT", "Mint"].map((p) => (
            <span key={p} className="px-3 py-1 rounded bg-surface-200 text-[10px] text-gray-500 font-medium">
              {p}
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}
