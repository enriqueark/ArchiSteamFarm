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

function formatRainAmount(atomic: string): string {
  const n = Number(atomic || "0");
  if (!Number.isFinite(n)) return "$0";
  const coins = n / 1e8;
  return `$${coins.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getNextHalfHourBoundaryCET(now = new Date()): Date {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const byType = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const year = Number(byType("year"));
  const month = Number(byType("month"));
  const day = Number(byType("day"));
  const hour = Number(byType("hour"));
  const minute = Number(byType("minute"));

  // Build an approximate UTC date matching the CET wall-clock parts,
  // then choose next :00/:30 boundary in that wall-clock space.
  const approxUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const next = new Date(approxUtc);
  if (minute < 30) {
    next.setUTCMinutes(30, 0, 0);
  } else {
    next.setUTCHours(next.getUTCHours() + 1, 0, 0, 0);
  }
  return next;
}

function formatNextRainCountdown(msLeft: number): string {
  if (msLeft <= 0) return "Next rain in 0 secs";
  const totalSec = Math.floor(msLeft / 1000);
  if (totalSec < 60) {
    return `Next rain in ${totalSec} secs`;
  }
  const min = Math.floor(totalSec / 60);
  return `Next rain in ${min} mins`;
}

function userColor(label: string): string {
  const palette = ["#53a3ff", "#7e53ff", "#ffc353", "#46d38a", "#ff7c93"];
  const seed = label.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return palette[Math.abs(seed) % palette.length];
}

function toUserFacingError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const msg = err.message?.trim();
  if (!msg) return fallback;
  const lower = msg.toLowerCase();
  if (lower.includes("internal error") || lower.includes("internal")) {
    return fallback;
  }
  if (lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("token")) {
    return "Please sign in to use chat.";
  }
  return msg;
}

export default function ChatPanel({ onClose }: Props) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [rain, setRain] = useState<RainState | null>(null);
  const [connectedUsers, setConnectedUsers] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [joiningRain, setJoiningRain] = useState(false);
  const [tippingRain, setTippingRain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
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
        // Keep initial chat load failures silent to avoid persistent UI noise.
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
      } else if (ev.type === "chat.presence") {
        setConnectedUsers(ev.data.onlineCount);
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

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const onlineCount = useMemo(() => {
    const fallbackByMessages = Math.max(15, messages.length);
    if (typeof connectedUsers === "number" && Number.isFinite(connectedUsers)) {
      return Math.max(15, Math.min(9999, connectedUsers));
    }
    return Math.min(9999, fallbackByMessages);
  }, [connectedUsers, messages.length]);

  const nextRainAt = useMemo(() => getNextHalfHourBoundaryCET(new Date(nowMs)), [nowMs]);
  const msUntilNextRain = Math.max(0, nextRainAt.getTime() - nowMs);
  const isJoinWindow = msUntilNextRain <= 60_000;
  const nextRainLabel = useMemo(() => formatNextRainCountdown(msUntilNextRain), [msUntilNextRain]);

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
      setError(toUserFacingError(e, "Failed to send message"));
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
      setError(toUserFacingError(e, "Failed to join rain"));
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
      setError(toUserFacingError(e, "Failed to tip rain"));
    } finally {
      setTippingRain(false);
    }
  };

  return (
    <aside
      className="w-[297px] shrink-0 rounded-[16px] flex flex-col overflow-hidden"
      style={{ background: "linear-gradient(180deg, #121212 0%, #0d0d0d 100%)" }}
    >
      {/* Header (matched to exported main-gl sizing) */}
      <div
        className="flex w-full items-center justify-between gap-[26px] overflow-hidden px-4 py-4 shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424]"
        style={{ background: "linear-gradient(180deg, #1a1a1a 0%, #282828 100%)" }}
      >
        <div className="flex w-fit items-center gap-3">
          <div className="flex w-fit items-center gap-2">
            <img src="/assets/a4366a4ae3e473020ab9cbb4e6f51869.svg" alt="chat" className="h-8 w-8" />
            <span className="text-[18px] font-medium leading-[18px] text-white">Chat</span>
          </div>
          <div className="flex w-fit items-center gap-2 px-[2px] py-[2px]">
            <span className="h-[10px] w-[10px] rounded-full bg-[#39ff8c] shadow-[0_0_10px_rgba(57,255,140,0.9)]" />
            <span className="text-[18px] font-medium leading-[18px] text-white">{onlineCount}</span>
          </div>
        </div>
        <button onClick={onClose} className="chat-red-icon-btn mr-[2px]" title="Close chat">
          <img
            src="/assets/ff7b4a95d6ca0ac94428eb89d87fdc5a.svg"
            alt="close"
            className="h-[42px] w-[42px] rounded-[8px] opacity-95"
          />
        </button>
      </div>

      {/* Live Rain card (layout matched to reference: icon left, text center, amount/right controls) */}
      <div className="mx-auto my-4 w-[265px]">
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            if (!joiningRain) {
              void handleJoinRain();
            }
          }}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !joiningRain) {
              e.preventDefault();
              void handleJoinRain();
            }
          }}
          className={`relative min-h-[76px] w-[265px] overflow-hidden rounded-[12px] border border-[#5a4723] ${
            joiningRain ? "cursor-wait opacity-80" : "cursor-pointer"
          }`}
          style={{
            background: "linear-gradient(90deg, #1a1a1a 0%, #1a1a1a 62%, rgba(255, 195, 83, 0.2) 100%)",
            boxShadow: "inset 0 0 0 1px rgba(255, 195, 83, 0.12), 0 0 10px rgba(255, 195, 83, 0.08)"
          }}
          title="Join rain"
        >
          <div className="pointer-events-none absolute right-0 top-0 h-full w-[124px] bg-gradient-to-l from-[rgba(255,195,83,0.22)] via-[rgba(255,195,83,0.08)] to-transparent" />
          <div className="rain-gold-sweep pointer-events-none absolute inset-0 z-[1] rounded-[12px]" />

          <div className="relative z-10 flex min-h-[76px] items-center justify-between px-[10px]">
            <div className="flex min-w-0 items-center gap-[9px]">
              <img
                src="/figma-main/assets/cd5bcd223ad039502b06fe463c0a7508.png"
                alt="Live rain"
                className="h-[52px] w-[52px] shrink-0 object-cover"
              />
              <div className="min-w-0">
                <p className="m-0 text-left text-[18px] font-medium leading-[18px] text-white">Live Rain</p>
                <p className="mt-[4px] whitespace-nowrap text-left text-[14px] font-normal leading-[14px] text-[#828282]">
                  {nextRainLabel}
                </p>
              </div>
            </div>

            <div className="ml-2 flex shrink-0 items-center gap-[6px]">
              <div className="rounded-[8px] bg-[#111111] px-[8px] py-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),inset_0_-1px_0_rgba(0,0,0,0.55)]">
                <p className="m-0 text-left text-[18px] font-medium leading-[18px] text-white">
                  {rain ? formatRainAmount(rain.totalAmountAtomic) : "$0.00"}
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleTipRain();
                }}
                disabled={tippingRain}
                className="flex h-[24px] w-[24px] items-center justify-center rounded-[5px] text-[18px] font-medium leading-[18px] text-[#090909] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] disabled:opacity-60"
                style={{ background: "linear-gradient(180deg, #b57601 0%, #ffc353 100%)" }}
                title="Tip rain"
              >
                +
              </button>
            </div>
          </div>
        </div>
        {isJoinWindow ? (
          <div className="mt-2 rounded-[8px] border border-[#ffd869] bg-gradient-to-r from-[#ffe66f] to-[#ffc94d] px-3 py-2 text-center text-[20px] font-bold leading-[20px] text-[#201708] shadow-[0_0_18px_rgba(255,205,90,0.35)]">
            Join Rain
          </div>
        ) : null}
      </div>

      {/* Messages */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {messages.map((m, i) => (
          <div key={m.id || i} className="flex items-start gap-3 py-1">
            {m.avatarUrl ? (
              <img src={m.avatarUrl} alt={m.username} className="w-10 h-10 rounded-[12px] shrink-0 object-cover" />
            ) : (
              <div
                className="w-10 h-10 rounded-[12px] shrink-0 flex items-center justify-center text-white text-xs font-bold"
                style={{ backgroundColor: "#1f1f1f", border: "1px solid #2a2a2a" }}
              >
                {(m.username || "U").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1 max-w-[213px]">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm font-medium" style={{ color: userColor(m.username || "Player") }}>
                  {m.username || "Player"}
                </span>
                <span
                  className="text-[10px] px-[6px] py-[2px] rounded-[6px] font-bold"
                  style={{
                    border: `1px solid ${userColor(m.username || "Player")}`,
                    color: userColor(m.username || "Player")
                  }}
                >
                  {m.userLevel || 1}
                </span>
                </div>
                <span className="text-[11px] text-[#828282] whitespace-nowrap">{formatRelative(m.createdAt)}</span>
              </div>
              <div className="rounded-[8px] bg-[#161616] px-3 py-2">
                <p className="text-[14px] leading-[18px] text-white">{m.message}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Input (matched to exported main-gl sizing) */}
      <div
        className="w-full shrink-0 overflow-hidden rounded-b-[16px] px-[10px] py-4 shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424]"
        style={{ background: "linear-gradient(180deg, #282828 0%, #1a1a1a 100%)" }}
      >
        <div className="flex items-center gap-2 rounded-[14px] bg-[#0d0d0d] p-[6px]">
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
            className="min-w-0 flex-1 bg-transparent px-3 text-[16px] font-medium leading-5 text-white placeholder-[#828282] outline-none"
          />
          <div className="flex shrink-0 items-center gap-[7px] pr-[1px]">
            <button
              type="button"
              className="flex h-6 w-6 shrink-0 items-center justify-center cursor-pointer opacity-95 transition-opacity hover:opacity-100"
              title="Emoji"
            >
              <img
                src="/assets/bef874df2fc950fc61f328c3bb49b78f.svg"
                alt="emoji"
                className="h-6 w-6"
                style={{ filter: "drop-shadow(0 0 3px rgba(255,255,255,0.18))" }}
              />
            </button>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={sending}
              className={`chat-send-btn ${sending ? "opacity-100" : "opacity-95 hover:opacity-100"}`}
              title="Send message"
            >
              <img src="/assets/e4d41a686d7d0a9814458dd69c7d611d.svg" alt="send" className="h-[22px] w-[22px]" />
            </button>
          </div>
        </div>
        {error && <p className="mt-2 text-[11px] text-accent-red">{error}</p>}
      </div>
      <style jsx>{`
        .chat-red-icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: filter 180ms ease, transform 180ms ease;
        }

        .chat-red-icon-btn:hover {
          filter: brightness(1.06);
        }

        .chat-red-icon-btn:active {
          transform: translateY(1px);
        }

        .chat-send-btn {
          width: 42px;
          height: 42px;
          flex-shrink: 0;
          border-radius: 8px;
          border: 1px solid rgba(255, 95, 99, 0.65);
          background: linear-gradient(180deg, #8f2526 0%, #d94547 56%, #f24f51 100%);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-shadow: inset 0 1px 0 rgba(255, 175, 175, 0.4), inset 0 -1px 0 rgba(128, 19, 20, 0.8);
          transition: filter 180ms ease, transform 180ms ease;
        }

        .chat-send-btn:hover {
          filter: brightness(1.05);
        }

        .chat-send-btn:active {
          transform: translateY(1px);
        }

        .rain-gold-border {
          border: 1px solid rgba(255, 195, 83, 0.28);
          box-shadow:
            inset 0 0 0 1px rgba(255, 195, 83, 0.16),
            inset 0 0 16px rgba(255, 195, 83, 0.06);
        }

        .rain-gold-flow {
          background-image:
            radial-gradient(130px 78px at 44px 38px, rgba(255, 195, 83, 0.52) 0%, rgba(255, 195, 83, 0.26) 42%, rgba(255, 195, 83, 0.08) 62%, rgba(255, 195, 83, 0) 82%),
            linear-gradient(90deg, rgba(255, 195, 83, 0.34) 0%, rgba(255, 195, 83, 0.2) 24%, rgba(255, 195, 83, 0.11) 44%, rgba(255, 195, 83, 0) 74%);
          background-repeat: no-repeat;
          background-size: 100% 100%, 110% 100%;
          animation: rainGoldFlow 2.4s ease-in-out infinite;
          opacity: 0.92;
        }

        .rain-gold-sweep {
          left: -35%;
          right: -35%;
          background: linear-gradient(
            108deg,
            rgba(255, 195, 83, 0) 28%,
            rgba(255, 195, 83, 0.08) 36%,
            rgba(255, 195, 83, 0.44) 49%,
            rgba(255, 195, 83, 0.18) 58%,
            rgba(255, 195, 83, 0) 70%
          );
          filter: blur(6px);
          mix-blend-mode: screen;
          opacity: 0;
          transform: translateX(28%);
          animation: rainGoldSweep 2.8s linear infinite;
        }

        @keyframes rainGoldFlow {
          0% {
            background-position: 0% 50%, -8% 50%;
            opacity: 0.82;
          }
          50% {
            background-position: 10% 50%, 4% 50%;
            opacity: 0.98;
          }
          100% {
            background-position: 0% 50%, -8% 50%;
            opacity: 0.82;
          }
        }

        @keyframes rainGoldSweep {
          0% {
            transform: translateX(34%);
            opacity: 0;
          }
          12% {
            opacity: 0.9;
          }
          82% {
            transform: translateX(-34%);
            opacity: 0.88;
          }
          100% {
            transform: translateX(-48%);
            opacity: 0;
          }
        }
      `}</style>
    </aside>
  );
}
