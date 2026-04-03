import { useState } from "react";

interface Props {
  onClose: () => void;
}

const messages = [
  { user: "WildHub", badge: 14, badgeColor: "#53a3ff", avatar: "/assets/77057efdbb31f518db87124adf213118.jpg", msg: "Hi, how are you doing?", time: "5 min ago" },
  { user: "Jake", badge: 6, badgeColor: "#7e53ff", avatar: "/assets/2890cda56dbb3e176f67ef600d3feeb9.jpg", msg: "It's okay, what skins fell out today?", time: "2 min ago" },
  { user: "Steve", badge: 93, badgeColor: "#ffc353", avatar: "/assets/65a4a37ef0476762188eb0e92fccfa64.jpg", msg: "Use this promo code for the deposit XP31S", time: "1 min ago" },
  { user: "WildHub", badge: 14, badgeColor: "#53a3ff", avatar: "/assets/97890d0933872b6f404a8a4618df0a98.jpg", msg: "Hi, how are you doing?", time: "5 min ago" },
  { user: "Jake", badge: 6, badgeColor: "#7e53ff", avatar: "/assets/024f62d6e6fa2c9a8d91e8b17ff935ea.jpg", msg: "It's okay, what skins fell out today?", time: "2 min ago" },
  { user: "Steve", badge: 93, badgeColor: "#ffc353", avatar: "/assets/5df7c774232188e8f79288042b544f94.jpg", msg: "Use this promo code for the deposit XP31S", time: "1 min ago" },
];

export default function ChatPanel({ onClose }: Props) {
  const [message, setMessage] = useState("");

  return (
    <aside
      className="w-[297px] shrink-0 rounded-card flex flex-col overflow-hidden"
      style={{ background: "linear-gradient(180deg, #121212 0%, #0d0d0d 100%)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ background: "linear-gradient(180deg, #1a1a1a 0%, #282828 100%)" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <img src="/assets/a4366a4ae3e473020ab9cbb4e6f51869.svg" alt="chat" className="w-5 h-5" />
            <span className="text-sm font-medium text-accent-red">Chat</span>
          </div>
          <div className="flex items-center gap-1.5 bg-[#161616] rounded-md px-2 py-1">
            <img src="/assets/7633b71f35a53e0231fddc5fed059472.svg" alt="" className="w-3.5 h-3.5" />
            <span className="text-xs text-muted">130</span>
          </div>
        </div>
        <button onClick={onClose}>
          <img src="/assets/ff7b4a95d6ca0ac94428eb89d87fdc5a.svg" alt="close" className="w-5 h-5 opacity-60" />
        </button>
      </div>

      {/* Live Rain card */}
      <div className="mx-3 my-2 rounded-btn bg-[#161616] p-3 flex items-center gap-3">
        <img src="/assets/cd5bcd223ad039502b06fe463c0a7508.png" alt="" className="w-[52px] h-[52px] rounded-lg" />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">$71.2</span>
            <span className="w-5 h-5 rounded-full bg-accent-green/20 text-accent-green text-xs flex items-center justify-center font-bold">+</span>
          </div>
          <p className="text-xs font-medium text-white">Live Rain</p>
          <p className="text-[10px] text-muted">15 min ago</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <img src={m.avatar} alt={m.user} className="w-10 h-10 rounded-full shrink-0 object-cover" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-sm font-medium" style={{ color: m.badgeColor }}>{m.user}</span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                  style={{ border: `1px solid ${m.badgeColor}`, color: m.badgeColor }}
                >
                  {m.badge}
                </span>
                <span className="text-[10px] text-muted">{m.time}</span>
              </div>
              <p className="text-xs text-[#b2b2b2]">{m.msg}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div
        className="px-3 py-3"
        style={{ background: "linear-gradient(180deg, #282828 0%, #1a1a1a 100%)" }}
      >
        <div className="flex items-center gap-2 bg-[#161616] rounded-btn px-3 py-2.5">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write message..."
            className="flex-1 bg-transparent text-sm text-white placeholder-muted outline-none"
          />
          <img src="/assets/bef874df2fc950fc61f328c3bb49b78f.svg" alt="emoji" className="w-5 h-5 opacity-50 cursor-pointer" />
          <img src="/assets/e4d41a686d7d0a9814458dd69c7d611d.svg" alt="send" className="w-5 h-5 opacity-50 cursor-pointer" />
        </div>
      </div>
    </aside>
  );
}
