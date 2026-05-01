import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  getChatMessages,
  getRainState,
  joinRain,
  sendChatMessage,
  tipRain,
  tipUser,
  type ChatMessage,
  type RainState
} from "@/lib/api";
import { CasinoSocket, type SocketEvent } from "@/lib/socket";
import CoinAmount from "./CoinAmount";
import CoinIcon from "./CoinIcon";
import LevelBadge, { getTierColor } from "./LevelBadge";

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

function formatRainAmountFromCoins(coins: number): string {
  if (!Number.isFinite(coins)) return "0.00";
  return coins.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getMsUntilNextHalfHourBoundaryCET(now = new Date()): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const byType = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const minute = Number(byType("minute"));
  const second = Number(byType("second"));

  if (!Number.isFinite(minute) || !Number.isFinite(second)) {
    return 0;
  }

  const HALF_HOUR_MS = 30 * 60 * 1000;
  const elapsedInCurrentWindowMs = ((minute % 30) * 60 + second) * 1000 + now.getMilliseconds();
  const remaining = HALF_HOUR_MS - elapsedInCurrentWindowMs;
  return Math.max(0, Math.min(HALF_HOUR_MS, remaining));
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
  const CONTEXT_MENU_WIDTH = 200;
  const CONTEXT_MENU_ESTIMATED_HEIGHT = 166;
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [rain, setRain] = useState<RainState | null>(null);
  const [connectedUsers, setConnectedUsers] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [joiningRain, setJoiningRain] = useState(false);
  const [tippingRain, setTippingRain] = useState(false);
  const [tipRainModalOpen, setTipRainModalOpen] = useState(false);
  const [tipRainAmountInput, setTipRainAmountInput] = useState("1");
  const [tipRainModalError, setTipRainModalError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ user: ChatMessage; x: number; y: number } | null>(null);
  const [tipModal, setTipModal] = useState<ChatMessage | null>(null);
  const [tipAmount, setTipAmount] = useState("");
  const [tipSending, setTipSending] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);
  const [tipHide, setTipHide] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [animatedRainAmountCoins, setAnimatedRainAmountCoins] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<CasinoSocket | null>(null);
  const rainAmountAnimationFrameRef = useRef<number | null>(null);
  const animatedRainAmountCoinsRef = useRef(0);
  const rainAmountInitializedRef = useRef(false);

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
          userPublicId: ev.data.userPublicId ?? null,
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
          userPublicId: null,
          username: "System",
          userLevel: 0,
          avatarUrl: null,
          message: `${ev.data.fromUserLabel} tipped ${ev.data.toUserLabel} ${fromAtomicToCoins(ev.data.amountAtomic)} coins`,
          createdAt: ev.data.createdAt
        });
      } else if (ev.type === "rain.settled") {
        const winnerNames = ev.data.winners.map((winner) => winner.userLabel).slice(0, 6).join(", ");
        const suffix = ev.data.winners.length > 6 ? ", ..." : "";
        upsertMessage({
          id: `rain:settled:${ev.data.roundId}`,
          userId: "system",
          userPublicId: null,
          username: "System",
          userLevel: 0,
          avatarUrl: null,
          message: `Rain just given out ${ev.data.givenAmountCoins} coins to ${ev.data.winnerCount} users${
            winnerNames ? ` (${winnerNames}${suffix})` : ""
          }`,
          createdAt: new Date().toISOString()
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

  useEffect(() => {
    if (!rain?.totalAmountAtomic) {
      return;
    }
    const targetAtomic = Number(rain?.totalAmountAtomic ?? "0");
    const targetCoins = Number.isFinite(targetAtomic) ? targetAtomic / 1e8 : 0;

    if (!rainAmountInitializedRef.current) {
      rainAmountInitializedRef.current = true;
      animatedRainAmountCoinsRef.current = targetCoins;
      setAnimatedRainAmountCoins(targetCoins);
      return;
    }

    const startCoins = animatedRainAmountCoinsRef.current;
    const deltaCoins = Math.abs(targetCoins - startCoins);
    if (deltaCoins < 0.01) {
      animatedRainAmountCoinsRef.current = targetCoins;
      setAnimatedRainAmountCoins(targetCoins);
      return;
    }

    if (rainAmountAnimationFrameRef.current !== null) {
      cancelAnimationFrame(rainAmountAnimationFrameRef.current);
      rainAmountAnimationFrameRef.current = null;
    }

    // Duration grows with delta to make larger tips feel more "proportional".
    const durationMs = Math.max(320, Math.min(1800, 320 + deltaCoins * 170));
    const startedAt = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      const nextCoins = startCoins + (targetCoins - startCoins) * eased;
      animatedRainAmountCoinsRef.current = nextCoins;
      setAnimatedRainAmountCoins(nextCoins);

      if (progress < 1) {
        rainAmountAnimationFrameRef.current = requestAnimationFrame(tick);
      } else {
        rainAmountAnimationFrameRef.current = null;
      }
    };

    rainAmountAnimationFrameRef.current = requestAnimationFrame(tick);
  }, [rain?.totalAmountAtomic]);

  useEffect(
    () => () => {
      if (rainAmountAnimationFrameRef.current !== null) {
        cancelAnimationFrame(rainAmountAnimationFrameRef.current);
      }
    },
    []
  );

  const onlineCount = useMemo(() => {
    const fallbackByMessages = Math.max(15, messages.length);
    if (typeof connectedUsers === "number" && Number.isFinite(connectedUsers)) {
      return Math.max(15, Math.min(9999, connectedUsers));
    }
    return Math.min(9999, fallbackByMessages);
  }, [connectedUsers, messages.length]);

  const msUntilNextRain = useMemo(() => getMsUntilNextHalfHourBoundaryCET(new Date(nowMs)), [nowMs]);
  const isJoinWindow = msUntilNextRain <= 60_000;
  const nextRainLabel = useMemo(() => formatNextRainCountdown(msUntilNextRain), [msUntilNextRain]);

  const handleTip = async () => {
    if (!tipModal || tipSending) return;
    const amount = parseFloat(tipAmount);
    if (!amount || amount < 1) { setTipError("Minimum tip is 1 COIN"); return; }
    if (!tipModal.userPublicId || tipModal.userPublicId < 1) {
      setTipError("This user cannot receive tips right now.");
      return;
    }
    setTipSending(true); setTipError(null);
    try {
      await tipUser(tipModal.userPublicId, amount, undefined, tipHide);
      setTipModal(null); setTipAmount(""); setTipError(null);
    } catch (e: unknown) { setTipError(e instanceof Error ? e.message : "Tip failed"); }
    finally { setTipSending(false); }
  };

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
    if (!isJoinWindow) {
      setError("You can only join rain in the last minute.");
      return;
    }
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

  const openTipRainModal = () => {
    if (tippingRain) return;
    setTipRainAmountInput("");
    setTipRainModalError(null);
    setTipRainModalOpen(true);
  };

  const closeTipRainModal = () => {
    if (tippingRain) return;
    setTipRainModalOpen(false);
    setTipRainModalError(null);
  };

  const handleTipRain = async () => {
    if (tippingRain) return;
    const amountCoins = Number(tipRainAmountInput);
    if (!Number.isFinite(amountCoins) || amountCoins < 1) {
      setTipRainModalError("Tip amount must be at least 1 coin");
      return;
    }
    setTippingRain(true);
    setTipRainModalError(null);
    try {
      const result = await tipRain(amountCoins);
      setRain(result.rain);
      setTipRainModalOpen(false);
    } catch (e: unknown) {
      setTipRainModalError(toUserFacingError(e, "Failed to tip rain"));
    } finally {
      setTippingRain(false);
    }
  };

  const openContextMenu = (event: ReactMouseEvent<HTMLElement>, user: ChatMessage) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.max(8, Math.min(rect.left, viewportWidth - CONTEXT_MENU_WIDTH - 8));
    const top = Math.max(8, Math.min(rect.bottom + 4, viewportHeight - CONTEXT_MENU_ESTIMATED_HEIGHT - 8));
    setContextMenu({ user, x: left, y: top });
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
        <div className="flex w-fit items-center gap-2">
          <div className="flex w-fit items-center gap-2">
            <img src="/assets/a4366a4ae3e473020ab9cbb4e6f51869.svg" alt="chat" className="h-8 w-8" />
            <span className="text-[18px] font-medium leading-[18px] text-white">Chat</span>
          </div>
          <div className="ml-[8px] flex w-fit items-center gap-2 px-[2px] py-[2px]">
            <span className="chat-online-dot h-[10px] w-[10px] rounded-full bg-[#39ff8c]" />
            <span className="text-[18px] font-medium leading-[18px] text-white">{onlineCount}</span>
          </div>
        </div>
        <div className="flex w-fit items-center">
          <button onClick={onClose} className="chat-red-icon-btn mr-[2px]" title="Close chat">
            <img
              src="/assets/ff7b4a95d6ca0ac94428eb89d87fdc5a.svg"
              alt="close"
              className="h-[42px] w-[42px] rounded-[8px] opacity-95"
            />
          </button>
        </div>
      </div>

      {/* Live Rain card (layout matched to reference: icon left, text center, amount/right controls) */}
      <div className="mx-auto my-4 w-[265px]">
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            if (!joiningRain && isJoinWindow) {
              void handleJoinRain();
            }
          }}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !joiningRain && isJoinWindow) {
              e.preventDefault();
              void handleJoinRain();
            }
          }}
          className={`relative min-h-[76px] w-[265px] overflow-hidden rounded-[12px] border border-[#5a4723] ${
            joiningRain ? "cursor-wait opacity-80" : isJoinWindow ? "cursor-pointer" : "cursor-default"
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
              <div className="min-w-0 pt-[8px]">
                <p className="m-0 translate-y-[10px] text-left text-[18px] font-medium leading-[18px] text-white">Live Rain</p>
                <p className="mt-[22px] whitespace-nowrap text-left text-[14px] font-normal leading-[14px] text-[#828282]">
                  {nextRainLabel}
                </p>
              </div>
            </div>

            <div className="ml-2 flex shrink-0 items-center gap-[6px]">
              <div className="rounded-[8px] bg-[#111111] px-[8px] py-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),inset_0_-1px_0_rgba(0,0,0,0.55)]">
                <CoinAmount
                  amount={rain ? formatRainAmountFromCoins(animatedRainAmountCoins) : "0.00"}
                  iconSize={11}
                  textStyle={{ fontSize: 18, fontWeight: 500, color: "#ffffff", lineHeight: "18px" }}
                />
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openTipRainModal();
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
          <button
            type="button"
            onClick={() => void handleJoinRain()}
            disabled={joiningRain}
            className="mt-2 h-[40px] w-full rounded-[8px] border border-[rgba(255,95,99,0.7)] text-center text-[20px] font-bold leading-[20px] text-white shadow-[0_0_18px_rgba(242,79,81,0.45),inset_0_1px_0_rgba(255,175,175,0.35),inset_0_-1px_0_rgba(128,19,20,0.85)] transition-[filter,transform] duration-150 hover:brightness-105 active:translate-y-[1px] disabled:cursor-wait disabled:opacity-80"
            style={{ background: "linear-gradient(180deg, #8f2526 0%, #d94547 56%, #f24f51 100%)" }}
            title="Join Rain"
          >
            Join Rain
          </button>
        ) : null}
      </div>

      {/* Messages */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {messages.map((m, i) => (
          <div key={m.id || i} className="flex items-start gap-3 py-1">
            <div className="shrink-0 mt-5" onClick={(event) => openContextMenu(event, m)} style={{ cursor: "pointer" }}>
              {m.avatarUrl ? (
                <img src={m.avatarUrl} alt={m.username} className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: "#1f1f1f", border: "1px solid #2a2a2a" }}>
                  {(m.username || "U").slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 max-w-[213px]">
              <div className="flex items-center gap-1.5 mb-1" onClick={(event) => openContextMenu(event, m)} style={{ cursor: "pointer" }}>
                <span className="text-[13px] font-medium" style={{ color: getTierColor(m.userLevel || 1) }}>
                  {m.username || "Player"}
                </span>
                <LevelBadge level={m.userLevel || 1} />
              </div>
              <div
                className="rounded-[8px] bg-[#161616] px-3 py-2"
                onClick={(event) => openContextMenu(event, m)}
                style={{ cursor: "pointer" }}
              >
                <p className="text-[13px] leading-[17px] text-white">{m.message}</p>
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
              <svg viewBox="0 0 42 42" aria-hidden="true" className="h-[18px] w-[18px] text-white">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M28.3815 12.1225C29.4913 11.6551 30.6812 12.5936 30.4852 13.7819L28.1705 27.8164C27.9473 29.1696 26.461 29.9461 25.2196 29.2718C24.1807 28.7075 22.6394 27.839 21.2503 26.9313C20.5566 26.478 18.4327 25.0247 18.6938 23.9901C18.917 23.1055 22.4876 19.7818 24.528 17.8051C25.3294 17.0287 24.9644 16.5801 24.0179 17.295C21.6698 19.0684 17.9 21.7647 16.6533 22.5235C15.5534 23.193 14.9791 23.3073 14.2941 23.193C13.0432 22.9846 11.8835 22.6618 10.9367 22.2693C9.65695 21.7388 9.71928 19.9802 10.9358 19.468L28.3815 12.1225Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </div>
        {error && <p className="mt-2 text-[11px] text-accent-red">{error}</p>}
      </div>

      {tipRainModalOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={closeTipRainModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#111", borderRadius: 16, padding: 24, width: 340, border: "1px solid #2a2a2a", boxShadow: "0 0 30px rgba(247,81,84,.15)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ color: "#f75154", fontSize: 18, fontWeight: 700, margin: 0, fontFamily: '"DM Sans",sans-serif' }}>Tip User</h3>
              <span onClick={closeTipRainModal} style={{ color: "#828282", cursor: "pointer", fontSize: 18 }}>✕</span>
            </div>
            <hr style={{ border: "none", borderTop: "1px solid #f7515430", marginBottom: 16 }} />

            <p style={{ color: "#f75154", fontSize: 13, margin: "0 0 6px", fontFamily: '"DM Sans",sans-serif' }}>User</p>
            <div style={{ background: "#1a1a1a", borderRadius: 10, padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
              <img src="/figma-main/assets/cd5bcd223ad039502b06fe463c0a7508.png" alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
              <span style={{ color: "#fff", fontSize: 14, fontFamily: '"DM Sans",sans-serif' }}>
                Rain (live rain pool)
              </span>
            </div>

            <p style={{ color: "#f75154", fontSize: 13, margin: "0 0 4px", fontFamily: '"DM Sans",sans-serif' }}>Tip Amount</p>
            <p style={{ color: "#828282", fontSize: 11, margin: "0 0 6px", fontFamily: '"DM Sans",sans-serif' }}>Minimum tip amount is 1 COIN</p>
            <div style={{ background: "#1a1a1a", borderRadius: 10, padding: "0 14px", height: 42, display: "flex", alignItems: "center", marginBottom: 12 }}>
              <CoinIcon size={18} style={{ marginRight: 6 }} />
              <input
                value={tipRainAmountInput}
                onChange={(event) => {
                  setTipRainAmountInput(event.target.value);
                  if (tipRainModalError) setTipRainModalError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleTipRain();
                  }
                }}
                inputMode="decimal"
                placeholder="0"
                disabled={tippingRain}
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 14, fontFamily: '"DM Sans",sans-serif' }}
              />
            </div>

            {tipRainModalError && <p style={{ color: "#f75154", fontSize: 12, margin: "0 0 8px" }}>{tipRainModalError}</p>}

            <button
              onClick={() => void handleTipRain()}
              disabled={tippingRain}
              style={{
                width: "100%", height: 44, borderRadius: 12, border: "none", cursor: "pointer",
                background: "linear-gradient(180deg, #f75154, #ac2e30)",
                boxShadow: "inset 0 1px 0 #f24f51, inset 0 -1px 0 #ff7476, 0 0 20px rgba(247,81,84,.2)",
                color: "#fff", fontSize: 16, fontWeight: 600, fontFamily: '"DM Sans",sans-serif',
                opacity: tippingRain ? 0.5 : 1,
              }}
            >
              {tippingRain ? "Sending..." : "Send tip"}
            </button>
          </div>
        </div>
      )}
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

        .chat-online-dot {
          box-shadow: 0 0 10px rgba(57, 255, 140, 0.9);
          animation: chatOnlinePulse 1.7s ease-in-out infinite;
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
          box-shadow: 0 0 10px rgba(242, 79, 81, 0.22);
          transition: filter 180ms ease, transform 180ms ease;
        }

        .chat-send-btn:hover {
          filter: brightness(1.05);
        }

        .chat-send-btn:active {
          transform: translateY(1px);
        }

        @keyframes chatOnlinePulse {
          0%,
          100% {
            opacity: 1;
            box-shadow: 0 0 10px rgba(57, 255, 140, 0.9);
            transform: scale(1);
          }
          50% {
            opacity: 0.35;
            box-shadow: 0 0 4px rgba(57, 255, 140, 0.4);
            transform: scale(0.92);
          }
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

      {/* Context menu */}
      {contextMenu && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100 }} onClick={() => setContextMenu(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: contextMenu.y,
              left: contextMenu.x,
              width: 200,
              background: "linear-gradient(180deg, #161616 0%, #0d0d0d 100%)",
              borderRadius: 12,
              boxShadow: "0 11px 43.4px 0 rgba(0, 0, 0, 0.34), inset 0 1px 0 0 #252525, inset 0 -1px 0 0 #242424",
              border: "1px solid #222222",
              padding: "6px 0",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => {
                const target =
                  contextMenu.user.userPublicId && contextMenu.user.userPublicId > 0
                    ? `/profile/${contextMenu.user.userPublicId}`
                    : `/profile/user/${contextMenu.user.userId}`;
                window.open(target, "_blank");
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-3 px-[18px] py-3 text-left transition-colors duration-150 hover:bg-[#1f1f1f]"
              style={{ color: "#ffffff", textDecoration: "none", fontSize: 15, fontWeight: 500, fontFamily: "Inter, system-ui, sans-serif" }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff4d6d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21V19C20 17.3431 18.6569 16 17 16H7C5.34315 16 4 17.3431 4 19V21" />
                <path d="M12 11C14.2091 11 16 9.20914 16 7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7C8 9.20914 9.79086 11 12 11Z" />
              </svg>
              <span style={{ fontSize: 15, fontWeight: 500 }}>View Profile</span>
            </button>

            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(String(contextMenu.user.userPublicId ?? contextMenu.user.userId));
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-3 px-[18px] py-3 text-left transition-colors duration-150 hover:bg-[#1f1f1f]"
              style={{ color: "#ffffff", textDecoration: "none", fontSize: 15, fontWeight: 500, fontFamily: "Inter, system-ui, sans-serif" }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff4d6d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
              </svg>
              <span style={{ fontSize: 15, fontWeight: 500 }}>Copy ID</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setTipModal(contextMenu.user);
                setContextMenu(null);
                setTipAmount("");
                setTipError(null);
              }}
              className="flex w-full items-center gap-3 px-[18px] py-3 text-left transition-colors duration-150 hover:bg-[#1f1f1f]"
              style={{ color: "#ffffff", textDecoration: "none", fontSize: 15, fontWeight: 500, fontFamily: "Inter, system-ui, sans-serif" }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff4d6d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 12v10H4V12" />
                <path d="M2 7h20v5H2z" />
                <path d="M12 22V7" />
                <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z" />
                <path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
              </svg>
              <span style={{ fontSize: 15, fontWeight: 500 }}>Tip</span>
            </button>
          </div>
        </div>
      )}

      {/* Tip modal */}
      {tipModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setTipModal(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#111", borderRadius: 16, padding: 24, width: 340, border: "1px solid #2a2a2a", boxShadow: "0 0 30px rgba(247,81,84,.15)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ color: "#f75154", fontSize: 18, fontWeight: 700, margin: 0, fontFamily: '"DM Sans",sans-serif' }}>Tip User</h3>
              <span onClick={() => setTipModal(null)} style={{ color: "#828282", cursor: "pointer", fontSize: 18 }}>✕</span>
            </div>
            <hr style={{ border: "none", borderTop: "1px solid #f7515430", marginBottom: 16 }} />

            <p style={{ color: "#f75154", fontSize: 13, margin: "0 0 6px", fontFamily: '"DM Sans",sans-serif' }}>User</p>
            <div style={{ background: "#1a1a1a", borderRadius: 10, padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
              {tipModal.avatarUrl ? (
                <img src={tipModal.avatarUrl} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
              ) : (
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#252525", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700 }}>
                  {(tipModal.username || "U")[0].toUpperCase()}
                </div>
              )}
              <span style={{ color: "#fff", fontSize: 14, fontFamily: '"DM Sans",sans-serif' }}>
                {tipModal.username} (id: {tipModal.userPublicId ?? "N/A"})
              </span>
            </div>

            <p style={{ color: "#f75154", fontSize: 13, margin: "0 0 4px", fontFamily: '"DM Sans",sans-serif' }}>Tip Amount</p>
            <p style={{ color: "#828282", fontSize: 11, margin: "0 0 6px", fontFamily: '"DM Sans",sans-serif' }}>Minimum tip amount is 1 COIN</p>
            <div style={{ background: "#1a1a1a", borderRadius: 10, padding: "0 14px", height: 42, display: "flex", alignItems: "center", marginBottom: 12 }}>
              <CoinIcon size={18} style={{ marginRight: 6 }} />
              <input value={tipAmount} onChange={(e) => setTipAmount(e.target.value)} placeholder="0"
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 14, fontFamily: '"DM Sans",sans-serif' }} />
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, cursor: "pointer" }}>
              <input type="checkbox" checked={tipHide} onChange={(e) => setTipHide(e.target.checked)} style={{ accentColor: "#f75154" }} />
              <span style={{ color: "#828282", fontSize: 12, fontFamily: '"DM Sans",sans-serif' }}>Don&apos;t show tip in chat</span>
            </label>

            {tipError && <p style={{ color: "#f75154", fontSize: 12, margin: "0 0 8px" }}>{tipError}</p>}

            <button onClick={handleTip} disabled={tipSending} style={{
              width: "100%", height: 44, borderRadius: 12, border: "none", cursor: "pointer",
              background: "linear-gradient(180deg, #f75154, #ac2e30)",
              boxShadow: "inset 0 1px 0 #f24f51, inset 0 -1px 0 #ff7476, 0 0 20px rgba(247,81,84,.2)",
              color: "#fff", fontSize: 16, fontWeight: 600, fontFamily: '"DM Sans",sans-serif',
              opacity: tipSending ? 0.5 : 1,
            }}>
              {tipSending ? "Sending..." : "Send tip"}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
