import { getWsUrl } from "./api";

export type RouletteRoundEvent = {
  roundId: string;
  roundNumber: number;
  currency: string;
  status: string;
  openAt: string;
  betsCloseAt: string;
  spinStartsAt: string;
  settleAt: string;
  winningNumber: number | null;
  winningColor: string | null;
  totalStakedAtomic: string;
  totalPayoutAtomic: string;
};

export type BetTotalsEvent = {
  roundId: string;
  currency: string;
  totalStakedAtomic: string;
};

export type SocketEvent =
  | { type: "roulette.round"; data: RouletteRoundEvent }
  | { type: "roulette.betTotals"; data: BetTotalsEvent }
  | {
      type: "chat.message";
      data: {
        id: string;
        userId: string;
        userLabel: string;
        level: number;
        avatarUrl: string | null;
        message: string;
        createdAt: string;
      };
    }
  | {
      type: "chat.cleared";
      data: {
        reason: "ADMIN_COMMAND" | "HOURLY_RESET";
        clearedAt: string;
      };
    }
  | {
      type: "rain.state";
      data: {
        roundId: string;
        startsAt: string;
        endsAt: string;
        baseAmountAtomic: string;
        tippedAmountAtomic: string;
        totalAmountAtomic: string;
        joinedCount: number;
      };
    }
  | {
      type: "rain.tipped";
      data: {
        roundId: string;
        userId: string;
        amountAtomic: string;
        tippedAmountAtomic: string;
        totalAmountAtomic: string;
      };
    }
  | {
      type: "rain.joined";
      data: {
        roundId: string;
        userId: string;
        joinedCount: number;
      };
    }
  | {
      type: "chat.userTip";
      data: {
        id: string;
        fromUserId: string;
        fromUserLabel: string;
        toUserId: string;
        toUserLabel: string;
        amountAtomic: string;
        message: string | null;
        createdAt: string;
      };
    }
  | {
      type: "chat.presence";
      data: {
        onlineCount: number;
      };
    }
  | { type: "pong"; data: { type: "pong"; ts: string } }
  | { type: "open" }
  | { type: "close" }
  | { type: "error"; error: Event };

type Listener = (event: SocketEvent) => void;

export class CasinoSocket {
  private ws: WebSocket | null = null;
  private listeners: Listener[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private currency: string;
  private _connected = false;

  constructor(currency = "USDT") {
    this.currency = currency;
  }

  get connected() {
    return this._connected;
  }

  connect() {
    if (this.ws) this.disconnect();

    const url = `${getWsUrl()}?currency=${this.currency}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this._connected = true;
      this.emit({ type: "open" });
      this.startPing();
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.emit({ type: "close" });
      this.stopPing();
      this.scheduleReconnect();
    };

    this.ws.onerror = (e) => {
      this.emit({ type: "error", error: e });
    };

    this.ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        const eventType = parsed.type || parsed.event;
        if (eventType === "roulette.round") {
          this.emit({ type: "roulette.round", data: parsed.data || parsed });
        } else if (eventType === "roulette.betTotals") {
          this.emit({ type: "roulette.betTotals", data: parsed.data || parsed });
        } else if (eventType === "chat.message") {
          this.emit({ type: "chat.message", data: parsed.data || parsed });
        } else if (eventType === "chat.cleared") {
          this.emit({ type: "chat.cleared", data: parsed.data || parsed });
        } else if (eventType === "rain.state") {
          this.emit({ type: "rain.state", data: parsed.data || parsed });
        } else if (eventType === "rain.tipped") {
          this.emit({ type: "rain.tipped", data: parsed.data || parsed });
        } else if (eventType === "rain.joined") {
          this.emit({ type: "rain.joined", data: parsed.data || parsed });
        } else if (eventType === "chat.userTip") {
          this.emit({ type: "chat.userTip", data: parsed.data || parsed });
        } else if (eventType === "chat.presence") {
          this.emit({ type: "chat.presence", data: parsed.data || parsed });
        } else if (eventType === "pong") {
          this.emit({ type: "pong", data: parsed });
        }
      } catch {
        // ignore unparseable messages
      }
    };
  }

  disconnect() {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }

  subscribe(listener: Listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(event: SocketEvent) {
    this.listeners.forEach((l) => l(event));
  }

  private startPing() {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 12_000);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect() {
    this.reconnectTimer = setTimeout(() => this.connect(), 3_000);
  }
}
