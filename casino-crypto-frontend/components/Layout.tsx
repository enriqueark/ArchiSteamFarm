import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useState } from "react";
import ChatPanel from "./ChatPanel";

const sideIcons = [
  { href: "/", src: "/assets/976039a8dadda2c262ac3ebbbd8ca834.svg", alt: "Home" },
  { href: "/roulette", src: "/assets/138b5ed291793fe7e3a99f5ebfe8d972.svg", alt: "Roulette" },
  { href: "/mines", src: "/assets/fc114122ca6a2b7db5205fd3c5a1cb2c.svg", alt: "Mines" },
  { href: "/wallet", src: "/assets/8ffba4817b8664c5480ee873923615b0.svg", alt: "Wallet" },
  { href: "#", src: "/assets/b12fc678f16ee563f84635f59fbeb5f2.svg", alt: "More" },
];

const tickerItems = [
  { name1: "Glock-18", name2: "Fully Tuned", price: "$372.40", img: "/assets/f63c2cd4da0ec0435110a1b9c9ef00e2.png" },
  { name1: "AK-47", name2: "Crane Flight", price: "$173.20", img: "/assets/10f7228f5888a7f2af7cf8f58c41b39c.png" },
  { name1: "Sport Gloves", name2: "Occult", price: "$6,272.40", img: "/assets/e6ed96c738fccc0c2b92e373ef7b0f0d.png" },
  { name1: "Glock-18", name2: "Fully Tuned", price: "$5.50", img: "/assets/e8fe8397d133349f0a66e88ad56ad8a3.png" },
  { name1: "Glock-18", name2: "Fully Tuned", price: "$0.07", img: "/assets/76c930f537afce25cccd693041595a91.png" },
  { name1: "Glock-18", name2: "Fully Tuned", price: "$372.40", img: "/assets/19b1de27547538914a0ceef2cbd778a1.png" },
  { name1: "AK-47", name2: "Crane Flight", price: "$173.20", img: "/assets/ae35fb723141a8d9021b06e414728039.png" },
  { name1: "Sport Gloves", name2: "Occult", price: "$6,272.40", img: "/assets/30296afbab04322852462f3914939c0e.png" },
  { name1: "Glock-18", name2: "Fully Tuned", price: "$5.50", img: "/assets/f63c2cd4da0ec0435110a1b9c9ef00e2.png" },
  { name1: "Glock-18", name2: "Fully Tuned", price: "$0.07", img: "/assets/10f7228f5888a7f2af7cf8f58c41b39c.png" },
];

interface Props {
  children: ReactNode;
  onLogout?: () => void;
  userEmail?: string;
}

export default function Layout({ children, onLogout, userEmail }: Props) {
  const router = useRouter();
  const [chatOpen, setChatOpen] = useState(true);

  return (
    <div className="min-h-screen flex bg-page">
      {/* Left sidebar */}
      <aside className="w-[62px] bg-chrome rounded-panel flex flex-col items-center py-2.5 gap-1 shrink-0">
        {sideIcons.map((item) => (
          <Link
            key={item.alt}
            href={item.href}
            title={item.alt}
            className={`w-[42px] h-[42px] flex items-center justify-center rounded-btn transition-all ${
              router.pathname === item.href ? "bg-[#1a1a1a]" : "hover:bg-[#161616]"
            }`}
          >
            <img src={item.src} alt={item.alt} width={24} height={24} />
          </Link>
        ))}
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top nav */}
        <header className="bg-chrome px-5 py-4 flex items-center justify-between shrink-0">
          {/* Left: hamburger + logo */}
          <div className="flex items-center gap-4">
            <img src="/assets/3df1f4631ccc25f16c81d64ff3af5f46.svg" alt="menu" className="w-6 h-6 opacity-60" />
            <Link href="/" className="flex items-center gap-2">
              <img src="/assets/7099b46c6cd5928db5dde5a0c11f93e0.svg" alt="logo" className="h-7" />
              <span className="text-lg font-bold tracking-wide text-white" style={{ fontStyle: "italic" }}>REDWATER</span>
            </Link>
          </div>

          {/* Center: nav pills */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-sm text-muted">
              <img src="/assets/9c5bb018d55a11c0b094ee2c9833d52f.svg" alt="" className="w-5 h-5" />
              <span>Rewards</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted">
              <img src="/assets/83d81222ca9a94fcdf1e086fa398eed1.svg" alt="" className="w-5 h-5" />
              <span>Affiliates</span>
            </div>
            <div className="flex items-center gap-2 bg-gradient-to-r from-[#b57601] to-[#ffc353] rounded-btn px-4 py-2">
              <img src="/assets/d9129866945bfa6765d5ea9981de3f1c.png" alt="" className="w-8 h-8" />
              <div className="leading-tight">
                <p className="text-xs font-bold text-[#382400]">WEEKLY</p>
                <p className="text-xs font-bold text-[#382400]">LEADERBOARD</p>
              </div>
            </div>
          </div>

          {/* Right: auth / user */}
          <div className="flex items-center gap-3">
            {userEmail ? (
              <>
                <span className="text-xs text-muted">{userEmail}</span>
                <button
                  onClick={onLogout}
                  className="px-6 py-2 rounded-btn bg-panel text-white text-sm font-medium shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424]"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <button className="px-7 py-2.5 rounded-btn bg-panel text-white text-sm font-medium shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424]">
                  Sign in
                </button>
                <button className="px-7 py-2.5 rounded-btn bg-gradient-to-r from-[#ac2e30] to-[#f75154] text-white text-sm font-medium shadow-[inset_0_1px_0_#f24f51,inset_0_-1px_0_#ff7476]">
                  Sign Up
                </button>
              </>
            )}
          </div>
        </header>

        {/* Ticker */}
        <div className="bg-strip rounded-panel mx-1 my-1 overflow-hidden">
          <div className="ticker-scroll flex items-center gap-1.5 py-1.5 px-1.5">
            {[...tickerItems, ...tickerItems].map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-2 min-w-[189px] h-[65px] rounded-btn px-3"
                style={{ background: "linear-gradient(180deg, #161616 0%, #0d0d0d 100%)" }}
              >
                <div className="relative w-[50px] h-[50px] shrink-0">
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-[32px] rounded-r bg-accent-red" />
                  <img src={item.img} alt={item.name2} className="w-full h-full object-contain" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-muted truncate">{item.name1}</p>
                  <p className="text-[11px] text-white truncate">{item.name2}</p>
                  <p className="text-[12px] font-medium text-accent-green">{item.price}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Content + Chat */}
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto px-5 py-4">
            {children}
          </main>
          {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
        </div>
      </div>
    </div>
  );
}
