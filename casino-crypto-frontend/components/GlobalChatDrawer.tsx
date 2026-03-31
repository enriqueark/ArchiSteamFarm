import { useCallback, useEffect, useMemo, useState } from "react";

import Button from "@/components/Button";
import Input from "@/components/Input";
import {
  getAccessToken,
  getChatMessages,
  getCurrentRain,
  getMe,
  joinRain,
  postChatMessage,
  tipRain,
  tipUser,
  type ChatMessage,
  type RainState
} from "@/lib/api";
import { CasinoSocket, type SocketEvent } from "@/lib/socket";
import { useAuthUI } from "@/lib/auth-ui";
import { useToast } from "@/lib/toast";

const CHAT_MAX_LENGTH = 300;
const INTERNAL_GAME_CURRENCY = "USDT";

type IncomingSocketChat = {
  id: string;
  userId: string;
  username?: string;
  userLabel?: string;
  level?: number;
  userLevel?: number;
  avatarUrl: string | null;
  message: string;
  createdAt: string;
};

const toChatMessage = (raw: IncomingSocketChat): ChatMessage => ({
  id: raw.id,
  userId: raw.userId,
  userLabel: raw.userLabel ?? raw.username ?? `user_${raw.userId.slice(0, 8)}`,
  userLevel: raw.userLevel ?? raw.level ?? 1,
  avatarUrl: raw.avatarUrl ?? null,
  message: raw.message,
  createdAt: raw.createdAt
});

const atomicToCoins = (atomic: string): number => {
  const parsed = Number(atomic);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed / 1e8;
};

export default function GlobalChatDrawer() {
  const { authed, openAuth } = useAuthUI();
  const { showError, showSuccess } = useToast();
  const [isOpen, setIsOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [rainState, setRainState] = useState<RainState | null>(null);
  const [rainTipAmount, setRainTipAmount] = useState("1");
  const [rainBusy, setRainBusy] = useState<"idle" | "join" | "tip">("idle");
  const [tipTargetPublicId, setTipTargetPublicId] = useState("");
  const [tipAmount, setTipAmount] = useState("1");
  const [tipMessage, setTipMessage] = useState("");
  const [tipBusy, setTipBusy] = useState(false);

  const mergeMessage = useCallback((incoming: ChatMessage) => {
    setMessages((prev) => {
      const next = [...prev.filter((entry) => entry.id !== incoming.id), incoming];
      next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return next.slice(-120);
    });
  }, []);

  useEffect(() => {
    if (!authed) {
      setMyUserId(null);
      setRainState(null);
      return;
    }
    getMe()
      .then((me) => setMyUserId(me.id))
      .catch(() => setMyUserId(null));
    getCurrentRain()
      .then(setRainState)
      .catch(() => setRainState(null));
  }, [authed]);

  useEffect(() => {
    getChatMessages(80)
      .then((rows) => setMessages(rows))
      .catch(() => {});

    const socket = new CasinoSocket(INTERNAL_GAME_CURRENCY);
    const unsubscribe = socket.subscribe((event: SocketEvent) => {
      if (event.type === "chat.message") {
        mergeMessage(toChatMessage(event.data as IncomingSocketChat));
        return;
      }
      if (event.type === "chat.cleared") {
        setMessages([]);
        return;
      }
      if (event.type === "rain.state") {
        const next = event.data;
        setRainState((prev) => ({
          roundId: next.roundId,
          startsAt: next.startsAt,
          endsAt: next.endsAt,
          baseAmountAtomic: next.baseAmountAtomic,
          tippedAmountAtomic: next.tippedAmountAtomic,
          totalAmountAtomic: next.totalAmountAtomic,
          joinedCount: next.joinedCount,
          hasJoined: typeof next.hasJoined === "boolean" ? next.hasJoined : prev?.hasJoined ?? false
        }));
        return;
      }
      if (event.type === "rain.joined") {
        setRainState((prev) =>
          prev && prev.roundId === event.data.roundId
            ? {
                ...prev,
                joinedCount: event.data.joinedCount,
                hasJoined: event.data.userId === myUserId ? true : prev.hasJoined
              }
            : prev
        );
        return;
      }
      if (event.type === "rain.tipped") {
        setRainState((prev) =>
          prev && prev.roundId === event.data.roundId
            ? {
                ...prev,
                tippedAmountAtomic: event.data.tippedAmountAtomic,
                totalAmountAtomic: event.data.totalAmountAtomic
              }
            : prev
        );
        return;
      }
      if (event.type === "rain.payout" && event.data.userId === myUserId) {
        showSuccess(`Rain payout received: ${atomicToCoins(event.data.payoutAtomic).toFixed(2)} COINS`);
        return;
      }
      if (event.type === "chat.userTip" && event.data.fromUserId === myUserId) {
        showSuccess(`Tip sent to ${event.data.toUserLabel}`);
      }
    });
    socket.connect();

    return () => {
      unsubscribe();
      socket.disconnect();
    };
  }, [mergeMessage, myUserId, showSuccess]);

  const sendChatMessage = async () => {
    if (!authed || !getAccessToken()) {
      openAuth("register");
      showError("Create an account to chat.");
      return;
    }

    const message = chatInput.trim();
    if (message.length === 0) {
      return;
    }

    setChatLoading(true);
    try {
      const created = await postChatMessage(message);
      mergeMessage(created);
      setChatInput("");
    } catch (error: unknown) {
      showError(error instanceof Error ? error.message : "Failed to send message");
    } finally {
      setChatLoading(false);
    }
  };

  const handleJoinRain = async () => {
    if (!authed || !getAccessToken()) {
      openAuth("login");
      return;
    }
    if (rainBusy !== "idle") {
      return;
    }
    setRainBusy("join");
    try {
      const next = await joinRain();
      setRainState(next);
      showSuccess("Joined rain.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Could not join rain");
    } finally {
      setRainBusy("idle");
    }
  };

  const handleTipRain = async () => {
    if (!authed || !getAccessToken()) {
      openAuth("login");
      return;
    }
    const amountCoins = Number(rainTipAmount);
    if (!Number.isFinite(amountCoins) || amountCoins < 1) {
      showError("Minimum rain tip is 1 coin.");
      return;
    }
    if (rainBusy !== "idle") {
      return;
    }
    setRainBusy("tip");
    try {
      const result = await tipRain(amountCoins);
      setRainState(result.rain);
      showSuccess("Rain tipped.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Could not tip rain");
    } finally {
      setRainBusy("idle");
    }
  };

  const handleTipUser = async () => {
    if (!authed || !getAccessToken()) {
      openAuth("login");
      return;
    }
    const toUserPublicId = Number(tipTargetPublicId);
    const amountCoins = Number(tipAmount);
    if (!Number.isInteger(toUserPublicId) || toUserPublicId <= 0) {
      showError("Enter a valid target User ID.");
      return;
    }
    if (!Number.isFinite(amountCoins) || amountCoins < 1) {
      showError("Minimum user tip is 1 coin.");
      return;
    }
    if (tipBusy) {
      return;
    }
    setTipBusy(true);
    try {
      await tipUser({
        toUserPublicId,
        amountCoins,
        message: tipMessage.trim() || undefined
      });
      setTipMessage("");
      showSuccess("Tip sent.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Could not tip user");
    } finally {
      setTipBusy(false);
    }
  };

  const toggleLabel = useMemo(() => (isOpen ? "Hide chat" : "Show chat"), [isOpen]);
  const rainPotCoins = useMemo(() => atomicToCoins(rainState?.totalAmountAtomic ?? "0"), [rainState?.totalAmountAtomic]);
  const rainEndsAtLabel = useMemo(() => {
    if (!rainState?.endsAt) {
      return "-";
    }
    return new Date(rainState.endsAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }, [rainState?.endsAt]);

  return (
    <div className="fixed bottom-0 right-0 top-[72px] z-40 pointer-events-none">
      <aside
        className={`pointer-events-auto relative h-full w-[270px] md:w-[290px] border-l border-cyan-500/40 bg-gray-950/95 shadow-[-20px_0_40px_rgba(0,0,0,0.45)] transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="absolute left-0 top-1/2 -translate-x-full -translate-y-1/2 rounded-l-xl border border-r-0 border-cyan-500/40 bg-gray-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-200 shadow-[0_10px_22px_rgba(0,0,0,0.35)]"
        >
          {toggleLabel}
        </button>

        <div className="flex h-full flex-col">
          <div className="border-b border-gray-800 px-3 py-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-100">Live chat</h3>
              <span className="text-[11px] text-gray-500">{messages.length} msgs</span>
            </div>
            <div className="mt-2 rounded border border-cyan-500/30 bg-cyan-950/20 px-2 py-2 text-[11px]">
              <p className="text-cyan-200">
                Rain pot: <span className="font-semibold">{rainPotCoins.toFixed(2)} COINS</span>
              </p>
              <p className="text-gray-400">Ends at: {rainEndsAtLabel}</p>
              <p className="text-gray-400">
                Joined: {rainState?.joinedCount ?? 0} {rainState?.hasJoined ? "• You are in" : ""}
              </p>
              <div className="mt-2 flex items-center gap-1">
                <Button
                  className="px-2 py-1 text-[10px]"
                  disabled={!authed || rainBusy !== "idle" || Boolean(rainState?.hasJoined)}
                  onClick={() => {
                    void handleJoinRain();
                  }}
                >
                  {rainBusy === "join" ? "Joining..." : rainState?.hasJoined ? "Joined" : "Join"}
                </Button>
                <input
                  className="w-14 rounded border border-gray-700 bg-gray-900 px-1.5 py-1 text-[10px] text-gray-100"
                  value={rainTipAmount}
                  onChange={(event) => setRainTipAmount(event.target.value)}
                  placeholder="1"
                />
                <Button
                  variant="secondary"
                  className="px-2 py-1 text-[10px]"
                  disabled={!authed || rainBusy !== "idle"}
                  onClick={() => {
                    void handleTipRain();
                  }}
                >
                  {rainBusy === "tip" ? "Tipping..." : "Tip rain"}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {messages.map((entry) => (
              <div key={entry.id} className="rounded-md border border-gray-800 bg-gray-900/70 px-2 py-1.5">
                <div className="flex items-center gap-2 text-[11px] text-gray-400">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-gray-200">
                    {entry.avatarUrl ? (
                      <img src={entry.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                    ) : (
                      entry.userLabel.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <span className="max-w-[140px] truncate font-semibold text-gray-200">{entry.userLabel}</span>
                  <span className="rounded bg-indigo-900/60 px-1.5 py-0.5 text-[10px] text-indigo-200">
                    LVL {entry.userLevel}
                  </span>
                </div>
                <p className="mt-1 break-words text-xs text-gray-200">{entry.message}</p>
              </div>
            ))}

            {messages.length === 0 ? <p className="text-xs text-gray-500">No messages yet.</p> : null}
          </div>

          <div className="border-t border-gray-800 px-3 py-3">
            <div className="space-y-2">
              <div className="rounded border border-gray-800 bg-gray-900/60 p-2">
                <p className="text-[11px] text-gray-400">Tip user by public ID</p>
                <div className="mt-1 grid grid-cols-3 gap-1">
                  <input
                    className="rounded border border-gray-700 bg-gray-900 px-1.5 py-1 text-[11px] text-gray-100"
                    placeholder="User ID"
                    value={tipTargetPublicId}
                    onChange={(event) => setTipTargetPublicId(event.target.value.replace(/\D/g, ""))}
                  />
                  <input
                    className="rounded border border-gray-700 bg-gray-900 px-1.5 py-1 text-[11px] text-gray-100"
                    placeholder="Coins"
                    value={tipAmount}
                    onChange={(event) => setTipAmount(event.target.value)}
                  />
                  <Button
                    variant="secondary"
                    className="px-1 py-1 text-[10px]"
                    disabled={!authed || tipBusy}
                    onClick={() => {
                      void handleTipUser();
                    }}
                  >
                    {tipBusy ? "..." : "Tip"}
                  </Button>
                </div>
                <input
                  className="mt-1 w-full rounded border border-gray-700 bg-gray-900 px-1.5 py-1 text-[11px] text-gray-100"
                  placeholder="Message (optional)"
                  value={tipMessage}
                  maxLength={120}
                  onChange={(event) => setTipMessage(event.target.value)}
                />
              </div>

              <Input
                label="Message"
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") {
                    return;
                  }
                  event.preventDefault();
                  if (chatLoading || chatInput.trim().length === 0) {
                    return;
                  }
                  void sendChatMessage();
                }}
                placeholder="Write message..."
                maxLength={CHAT_MAX_LENGTH}
              />
              <div className="flex items-center justify-between text-[11px] text-gray-500">
                <span>Max 300 chars</span>
                <span>{chatInput.length}/{CHAT_MAX_LENGTH}</span>
              </div>
              <Button
                className="w-full"
                onClick={() => void sendChatMessage()}
                disabled={chatLoading || chatInput.trim().length === 0}
              >
                {chatLoading ? "Sending..." : "Send"}
              </Button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
