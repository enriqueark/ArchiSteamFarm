import { useEffect, useMemo, useRef, useState } from "react";
import {
  getChatMessages,
  getRainState,
  joinRain,
  sendChatMessage,
  tipRain,
  type ChatMessage,
  type RainState
} from "@/lib/api";
import { CasinoSocket, type SocketEvent } from "@/lib/socket";

interface Props {
  onClose: () => void;
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "just now";
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `${diff}s ago`;
  const min = Math.floor(diff / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function fromAtomicToCoins(atomic: string): string {
  const n = Number(atomic || "0");
  if (!Number.isFinite(n)) return "0.00";
  return (n / 1e8).toFixed(2);
}

function userColor(label: string): string {
  const palette = ["#53a3ff", "#7e53ff", "#ffc353", "#46d38a", "#ff7c93"];
  const seed = label.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return palette[Math.abs(seed) % palette.length];
}

export default function ChatPanel({ onClose }: Props) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [rain, setRain] = useState<RainState | null>(null);
  const [sending, setSending] = useState(false);
  const [joiningRain, setJoiningRain] = useState(false);
  const [tippingRain, setTippingRain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<CasinoSocket | null>(null);

  const upsertMessage = (incoming: ChatMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === incoming.id)) {
        return prev;
      }
      return [...prev, incoming].slice(-100);
    });
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const chatRows = await getChatMessages(60);
        if (!mounted) return;
        setMessages(chatRows);
      } catch (e: unknown) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load chat");
      }
      try {
        const rainState = await getRainState();
        if (!mounted) return;
        setRain(rainState);
      } catch {
        // rain requires auth, ignore for guests
      }
    };
    void load();

    const sock = new CasinoSocket("USDT");
    socketRef.current = sock;
    sock.subscribe((ev: SocketEvent) => {
      if (!mounted) return;
      if (ev.type === "chat.message") {
        upsertMessage({
          id: ev.data.id,
          userId: ev.data.userId,
          username: ev.data.userLabel,
          userLevel: ev.data.level,
          avatarUrl: ev.data.avatarUrl,
          message: ev.data.message,
          createdAt: ev.data.createdAt
        });
      } else if (ev.type === "chat.cleared") {
        setMessages([]);
      } else if (ev.type === "rain.state") {
        setRain((prev) => ({
          roundId: ev.data.roundId,
          startsAt: ev.data.startsAt,
          endsAt: ev.data.endsAt,
          baseAmountAtomic: ev.data.baseAmountAtomic,
          tippedAmountAtomic: ev.data.tippedAmountAtomic,
          totalAmountAtomic: ev.data.totalAmountAtomic,
          joinedCount: ev.data.joinedCount,
          hasJoined: prev?.hasJoined ?? false
        }));
      } else if (ev.type === "rain.joined") {
        setRain((prev) =>
          prev
            ? {
                ...prev,
                joinedCount: ev.data.roundId === prev.roundId ? ev.data.joinedCount : prev.joinedCount
              }
            : prev
        );
      } else if (ev.type === "rain.tipped") {
        setRain((prev) => {
          if (!prev || ev.data.roundId !== prev.roundId) {
            return prev;
          }
          return {
            ...prev,
            tippedAmountAtomic: ev.data.tippedAmountAtomic,
            totalAmountAtomic: ev.data.totalAmountAtomic
          };
        });
      } else if (ev.type === "chat.userTip") {
        upsertMessage({
          id: ev.data.id,
          userId: "system",
          username: "System",
          userLevel: 0,
          avatarUrl: null,
          message: `${ev.data.fromUserLabel} tipped ${ev.data.toUserLabel} ${fromAtomicToCoins(ev.data.amountAtomic)} coins`,
          createdAt: ev.data.createdAt
        });
      }
    });
    sock.connect();
    return () => {
      mounted = false;
      sock.disconnect();
    };
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length]);

  const onlineCount = useMemo(() => Math.max(1, Math.min(9999, messages.length + 80)), [messages.length]);

  const handleSend = async () => {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const created = await sendChatMessage(text);
      upsertMessage(created);
      setMessage("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleJoinRain = async () => {
    if (!rain || joiningRain) return;
    setJoiningRain(true);
    setError(null);
    try {
      const next = await joinRain();
      setRain(next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to join rain");
    } finally {
      setJoiningRain(false);
    }
  };

  const handleTipRain = async () => {
    if (tippingRain) return;
    const raw = window.prompt("Tip amount (coins, min 1)", "1");
    if (!raw) return;
    const amountCoins = Number(raw);
    if (!Number.isFinite(amountCoins) || amountCoins < 1) {
      setError("Tip amount must be at least 1 coin");
      return;
    }
    setTippingRain(true);
    setError(null);
    try {
      const result = await tipRain(amountCoins);
      setRain(result.rain);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to tip rain");
    } finally {
      setTippingRain(false);
    }
  };

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
            <span className="text-xs text-muted">{onlineCount}</span>
          </div>
        </div>
        <button onClick={onClose}>
          <img src="/assets/ff7b4a95d6ca0ac94428eb89d87fdc5a.svg" alt="close" className="w-5 h-5 opacity-60 hover:opacity-100 transition-opacity" />
        </button>
      </div>

      {/* Live Rain card */}
      <div className="mx-3 my-2 rounded-btn bg-[#161616] p-3 flex items-center gap-3">
        <img src="/assets/cd5bcd223ad039502b06fe463c0a7508.png" alt="" className="w-[52px] h-[52px] rounded-lg" />
        <button className="text-left flex-1" onClick={() => void handleJoinRain()} disabled={joiningRain}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">
              {rain ? `${fromAtomicToCoins(rain.totalAmountAtomic)} coins` : "0.00 coins"}
            </span>
            <span
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void handleTipRain();
              }}
              className="w-5 h-5 rounded-full bg-accent-green/20 text-accent-green text-xs flex items-center justify-center font-bold cursor-pointer"
              title="Tip rain"
            >
              +
            </span>
          </div>
          <p className="text-xs font-medium text-white">Live Rain</p>
          <p className="text-[10px] text-muted">
            {rain ? `${rain.joinedCount} joined` : "No active rain"}
            {rain?.hasJoined ? " · Joined" : ""}
          </p>
        </button>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
        {messages.map((m, i) => (
          <div key={m.id || i} className="flex items-start gap-2.5">
            {m.avatarUrl ? (
              <img src={m.avatarUrl} alt={m.username} className="w-10 h-10 rounded-full shrink-0 object-cover" />
            ) : (
              <div
                className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
                style={{ backgroundColor: "#1f1f1f", border: "1px solid #2a2a2a" }}
              >
                {(m.username || "U").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-sm font-medium" style={{ color: userColor(m.username || "Player") }}>
                  {m.username || "Player"}
                </span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                  style={{
                    border: `1px solid ${userColor(m.username || "Player")}`,
                    color: userColor(m.username || "Player")
                  }}
                >
                  {m.userLevel || 1}
                </span>
                <span className="text-[10px] text-muted">{formatRelative(m.createdAt)}</span>
              </div>
              <p className="text-xs text-[#b2b2b2]">{m.message}</p>
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
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Write message..."
            className="flex-1 bg-transparent text-sm text-white placeholder-muted outline-none"
          />
          <img src="/assets/bef874df2fc950fc61f328c3bb49b78f.svg" alt="emoji" className="w-5 h-5 opacity-50 cursor-pointer hover:opacity-100 transition-opacity" />
          <img
            src="/assets/e4d41a686d7d0a9814458dd69c7d611d.svg"
            alt="send"
            onClick={() => void handleSend()}
            className={`w-5 h-5 cursor-pointer hover:opacity-100 transition-opacity ${
              sending ? "opacity-100" : "opacity-50"
            }`}
          />
        </div>
        {error && <p className="mt-2 text-[11px] text-accent-red">{error}</p>}
      </div>
    </aside>
  );
}
