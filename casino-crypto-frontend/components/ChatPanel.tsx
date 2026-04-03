import { useState } from "react";

interface Props {
  onClose: () => void;
}

const fakeMessages = [
  { user: "WildHub", level: 14, msg: "Hi, how are you doing?", time: "5 min ago", color: "text-blue-400" },
  { user: "Jake", level: 6, msg: "It's okay, what skins fell out today?", time: "4 min ago", color: "text-green-400" },
  { user: "Steve", level: 93, msg: "Use this promo code for the deposit XP315", time: "3 min ago", color: "text-orange-400" },
  { user: "WildHub", level: 14, msg: "Hi, how are you doing?", time: "2 min ago", color: "text-blue-400" },
  { user: "Jake", level: 6, msg: "It's okay, what skins fell out today?", time: "2 min ago", color: "text-green-400" },
  { user: "Steve", level: 93, msg: "Use this promo code for the deposit XP315", time: "1 min ago", color: "text-orange-400" },
];

export default function ChatPanel({ onClose }: Props) {
  const [message, setMessage] = useState("");

  return (
    <aside className="w-72 bg-surface-100 border-l border-border flex flex-col shrink-0">
      <div className="h-12 border-b border-border flex items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <span className="text-brand">💬</span>
          <span className="text-sm font-semibold text-white">Chat</span>
          <span className="text-xs bg-surface-300 text-gray-400 px-1.5 py-0.5 rounded">130</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white text-lg">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {fakeMessages.map((m, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="w-8 h-8 rounded-full bg-surface-300 flex items-center justify-center text-xs font-bold text-gray-400 shrink-0">
              {m.user[0]}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`text-xs font-semibold ${m.color}`}>{m.user}</span>
                <span className="text-[10px] bg-surface-300 text-gray-500 px-1 rounded">{m.level}</span>
                <span className="text-[10px] text-gray-600">{m.time}</span>
              </div>
              <p className="text-xs text-gray-300 mt-0.5">{m.msg}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2 bg-surface-200 rounded-lg px-3 py-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write message..."
            className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-600 outline-none"
          />
          <button className="text-brand hover:text-brand-light transition-colors">
            📨
          </button>
        </div>
      </div>
    </aside>
  );
}
