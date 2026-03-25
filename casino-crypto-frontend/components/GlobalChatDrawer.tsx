import { useCallback, useEffect, useMemo, useState } from "react";

import Button from "@/components/Button";
import Input from "@/components/Input";
import { getAccessToken, getChatMessages, postChatMessage, type ChatMessage } from "@/lib/api";
import { CasinoSocket, type SocketEvent } from "@/lib/socket";
import { useAuthUI } from "@/lib/auth-ui";

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

export default function GlobalChatDrawer() {
  const { authed, openAuth } = useAuthUI();
  const [isOpen, setIsOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const mergeMessage = useCallback((incoming: ChatMessage) => {
    setMessages((prev) => {
      const next = [...prev.filter((entry) => entry.id !== incoming.id), incoming];
      next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return next.slice(-120);
    });
  }, []);

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
      }
    });
    socket.connect();

    return () => {
      unsubscribe();
      socket.disconnect();
    };
  }, [mergeMessage]);

  const sendChatMessage = async () => {
    if (!authed || !getAccessToken()) {
      openAuth("register");
      setChatError("Create an account to chat.");
      return;
    }

    const message = chatInput.trim();
    if (message.length === 0) {
      return;
    }

    setChatError(null);
    setChatLoading(true);
    try {
      const created = await postChatMessage(message);
      mergeMessage(created);
      setChatInput("");
    } catch (error: unknown) {
      setChatError(error instanceof Error ? error.message : "Failed to send message");
    } finally {
      setChatLoading(false);
    }
  };

  const toggleLabel = useMemo(() => (isOpen ? "Hide chat" : "Show chat"), [isOpen]);

  return (
    <div className="fixed inset-y-0 right-0 z-40 pointer-events-none">
      <aside
        className={`pointer-events-auto relative h-screen w-[340px] border-l border-cyan-500/40 bg-gray-950/95 shadow-[-20px_0_40px_rgba(0,0,0,0.45)] transition-transform duration-300 ${
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
              {chatError ? <p className="text-xs text-red-400">{chatError}</p> : null}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
