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

export type BetBreakdownEvent = {
  roundId: string;
  roundNumber: number;
  currency: string;
  totalsAtomic: {
    RED: string;
    BLACK: string;
    GREEN: string;
    BAIT: string;
  };
  entriesByType: {
    RED: Array<{ userId: string; userLabel: string; stakeAtomic: string }>;
    BLACK: Array<{ userId: string; userLabel: string; stakeAtomic: string }>;
    GREEN: Array<{ userId: string; userLabel: string; stakeAtomic: string }>;
    BAIT: Array<{ userId: string; userLabel: string; stakeAtomic: string }>;
  };
  totalStakedAtomic: string;
};

export type RouletteSettlementSummaryEvent = {
  roundId: string;
  roundNumber: number;
  currency: string;
  winningNumber: number;
  winningColor: string;
  outcomes: Array<{
    userId: string;
    userLabel: string;
    netAtomic: string;
  }>;
};

export type ChatMessageEvent = {
  id: string;
  userId: string;
  username: string;
  level: number;
  avatarUrl: string | null;
  message: string;
  createdAt: string;
};

export type SocketEvent =
  | { type: "roulette.round"; data: RouletteRoundEvent }
  | { type: "roulette.betTotals"; data: BetTotalsEvent }
  | { type: "roulette.betBreakdown"; data: BetBreakdownEvent }
  | { type: "roulette.settlementSummary"; data: RouletteSettlementSummaryEvent }
  | { type: "chat.message"; data: ChatMessageEvent }
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
        } else if (eventType === "roulette.betBreakdown") {
          this.emit({ type: "roulette.betBreakdown", data: parsed.data || parsed });
        } else if (eventType === "roulette.settlementSummary") {
          this.emit({ type: "roulette.settlementSummary", data: parsed.data || parsed });
        } else if (eventType === "chat.message") {
          this.emit({ type: "chat.message", data: parsed.data || parsed });
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
