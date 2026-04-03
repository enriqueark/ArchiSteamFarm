import Link from "next/link";

const games = [
  { name: "CASES", href: "#", img: "/assets/c92374a7485d20ac9bbef2d35ed1a789.png", icon: "/assets/098fe17d7ecd701c12a38a0cadfb52c7.svg" },
  { name: "CASE BATTLE", href: "#", img: "/assets/9f3dc7144a620b11022014239169d46e.png", icon: "/assets/a3e58527c3e7370a1e8d3424ef21f14e.svg" },
  { name: "ROULETTE", href: "/roulette", img: "/assets/b8e5b82a90d613d81dd652412e8e23ee.png", icon: "/assets/30f1deaab44de7043abb1842bd019412.svg" },
  { name: "MINES", href: "/mines", img: "/assets/9d98d1f5815402cf67601802a236e1b3.png", icon: "/assets/a52450c41c59fc6f0f63e0a9e8b9be5b.svg" },
  { name: "BLACKJACK", href: "#", img: "/assets/cea3c3db4ef626ba499a275c20d4030a.png", icon: "/assets/d8347e0a14786c0b7e4e5b5719203353.svg" },
];

const avatars = [
  "/assets/647318fe66c8ea190b5fc1e87828feef.png",
  "/assets/7dcd70d5115f2bbcfa1a116069d6dfb7.png",
  "/assets/88d39b24f131a8d432606c8667bd8518.png",
  "/assets/185d36d385f62255b79bfdefbdd2287c.png",
  "/assets/e8fa67b539d2e4c42fd1d2468c0201f9.png",
  "/assets/058164da9a84df0225ff8ab330360f1c.png",
  "/assets/562eee842dd8250ebdd8d32be832b85e.png",
];

const highlights = Array.from({ length: 7 }, (_, i) => ({
  game: "Roulette",
  player: "WildHub",
  avatar: avatars[i % avatars.length],
  amount: "1.00",
  multi: "0.00x",
  payout: "0.00",
}));

const paymentIcons = [
  "/assets/1903346205e1d7861e96e48ef729ecb4.svg",
  "/assets/7ce9248d8ed70dcea02d587203a69379.svg",
  "/assets/8ccb1d8b0cc81c1b72e2ca61d0244f1e.svg",
  "/assets/f3e31c4e22d3356b101fb1ca2772558e.svg",
  "/assets/ea741470ab21c5753b5aa5b3f7159e37.svg",
  "/assets/469022e761f0ce059a4dbe7681ec4853.svg",
  "/assets/74ba8ca43e6f43bc7bcae3d0ffe144a5.svg",
  "/assets/0233322853161dd2c7fd57043a803cbb.svg",
  "/assets/88393c3b45f1b8ff20baa4b2f154f643.svg",
  "/assets/35903d683ebe29f6d6e095f24da6013e.svg",
];

const footerLinks: Record<string, string[]> = {
  Games: ["Cases", "Case Battles", "Roulette", "Mines", "BlackJack"],
  Platform: ["Rewards", "Affilates", "Blog", "Support", "FAQ", "Partnerships"],
  "About us": ["Tearms of Service", "Privacy Policy", "AML Policy", "Cookies Policy", "Self-Exclusion", "Fairness"],
  Community: ["Twitter", "Discord", "Telegram", "Kick"],
};

export default function HomePage() {
  return (
    <div className="space-y-6">
      {/* Banners */}
      <div className="grid grid-cols-2 gap-4">
        {[1, 2].map((n) => (
          <div
            key={n}
            className="h-[180px] rounded-card flex items-center justify-center"
            style={{ background: "linear-gradient(180deg, #161616 0%, #0d0d0d 100%)" }}
          >
            <span className="text-2xl font-bold text-muted/40">BANNER {n}</span>
          </div>
        ))}
      </div>

      {/* Games */}
      <div>
        <div className="flex items-center gap-2.5 mb-4">
          <img src="/assets/63c8c686837122667ee0f137787e2d7c.svg" alt="" className="w-6 h-6" />
          <h2 className="text-xl font-bold text-white">Games</h2>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {games.map((g) => (
            <Link
              key={g.name}
              href={g.href}
              className="group relative rounded-card overflow-hidden"
              style={{ background: "linear-gradient(180deg, #161616 0%, #0d0d0d 100%)" }}
            >
              {/* Red glow */}
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] h-[200px] rounded-full opacity-30 pointer-events-none"
                style={{ background: "radial-gradient(circle, #f75154 0%, transparent 70%)", filter: "blur(60px)" }}
              />
              {/* Game image */}
              <div className="relative h-[280px] flex items-center justify-center p-4">
                <img
                  src={g.img}
                  alt={g.name}
                  className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300"
                />
              </div>
              {/* Label bar */}
              <div className="relative flex items-center gap-2 px-4 py-3 bg-[#0d0d0d]/80">
                <img src={g.icon} alt="" className="w-5 h-5" />
                <span className="text-sm font-medium text-white">{g.name}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Highlights */}
      <div>
        {/* Title row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <img src="/assets/4e95822b3466acf681a95bd6c857747a.svg" alt="" className="w-6 h-6" />
            <h2 className="text-xl font-bold text-white">Highlights</h2>
          </div>
          <span className="text-sm text-muted cursor-pointer hover:text-white transition-colors">View All</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {["All Games", "Big wins", "My Games"].map((tab, i) => (
            <button
              key={tab}
              className={`px-5 py-2 rounded-btn text-sm font-medium transition-colors ${
                i === 0
                  ? "bg-panel text-white shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424]"
                  : "text-muted hover:text-white"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-card overflow-hidden" style={{ background: "linear-gradient(180deg, #161616 0%, #0d0d0d 100%)" }}>
          {/* Header */}
          <div className="grid grid-cols-5 px-5 py-3 text-xs font-medium text-muted border-b border-[#1a1a1a]">
            <span>Game</span>
            <span>Player</span>
            <span>Amount</span>
            <span>Multi</span>
            <span>Payout</span>
          </div>
          {/* Rows */}
          {highlights.map((h, i) => (
            <div key={i} className="grid grid-cols-5 items-center px-5 py-3 border-b border-[#111] last:border-b-0 hover:bg-[#1a1a1a]/30 transition-colors">
              <div className="flex items-center gap-2.5">
                <span className="w-[3px] h-5 rounded-r bg-accent-red" />
                <span className="text-sm text-white">{h.game}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <img src={h.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                <span className="text-sm font-medium text-white">{h.player}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-[#ffae50]/20" />
                <span className="text-sm text-white">{h.amount}</span>
              </div>
              <span className="text-sm text-muted">{h.multi}</span>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-[#ffae50]/20" />
                <span className="text-sm text-white">{h.payout}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="pt-8 pb-6">
        <div className="flex gap-10">
          {/* Brand column */}
          <div className="w-[280px] shrink-0">
            <div className="flex items-center gap-2 mb-3">
              <img src="/assets/8f21dcea07664a217d7d054711bb7e6a.svg" alt="logo" className="h-7" />
              <span className="text-lg font-bold text-white" style={{ fontStyle: "italic" }}>REDWATER</span>
            </div>
            <p className="text-xs text-muted mb-3">&copy; All rights reserved 2026</p>
            <p className="text-[11px] text-muted leading-relaxed mb-4">
              Upgrader is operated by Innospace LTD, Organization number 646564, Voukourestiou, 25 Neptune House, 1st Floor, Office 11, Zakaki, 3045, Limassol, Cyprus.
            </p>
            <div className="space-y-1 text-xs text-muted mb-4">
              <p>Support: <span className="text-white">support@redwater.gg</span></p>
              <p>Partners: <span className="text-white">partners@redwater.gg</span></p>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-[42px] h-[42px] rounded-pill border-2 border-accent-red text-accent-red text-sm font-bold flex items-center justify-center">18+</span>
              <p className="text-[10px] text-muted leading-snug">By accessing this site, you confirm that you are over 18 years old.</p>
            </div>
          </div>

          {/* Link columns */}
          <div className="flex-1 grid grid-cols-4 gap-6">
            {Object.entries(footerLinks).map(([title, links]) => (
              <div key={title}>
                <h3 className="text-sm font-semibold text-white mb-4">{title}</h3>
                <ul className="space-y-2.5">
                  {links.map((l) => (
                    <li key={l}>
                      <Link href="#" className="text-sm text-muted hover:text-white transition-colors">{l}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Payment icons */}
        <div className="mt-8 flex gap-3">
          {paymentIcons.map((src, i) => (
            <img key={i} src={src} alt="" className="w-[70px] h-[48px] object-contain" />
          ))}
        </div>
      </footer>
    </div>
  );
}
