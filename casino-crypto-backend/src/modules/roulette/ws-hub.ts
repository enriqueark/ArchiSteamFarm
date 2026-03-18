import { Currency, RouletteRoundStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { RawData, WebSocket } from "ws";

import { ensureRedisConnections, redisPublisher, redisSubscriber } from "../../infrastructure/redis/client";

type RouletteRealtimeEvent =
  | {
      type: "roulette.round";
      payload: {
        roundId: string;
        roundNumber: number;
        currency: Currency;
        status: RouletteRoundStatus;
        openAt: string;
        betsCloseAt: string;
        spinStartsAt: string;
        settleAt: string;
        winningNumber: number | null;
        winningColor: string | null;
        winningIsBait: boolean | null;
        totalStakedAtomic: string;
        totalPayoutAtomic: string;
      };
    }
  | {
      type: "roulette.betTotals";
      payload: {
        roundId: string;
        currency: Currency;
        totalStakedAtomic: string;
      };
    };

type ClientConnection = {
  id: string;
  socket: WebSocket;
  currency?: Currency;
  isAlive: boolean;
};

const WS_PING_INTERVAL_MS = 15_000;
const ROULETTE_WS_EVENT_CHANNEL = "roulette:ws:events";

const parseCurrencyFilter = (value: string | undefined): Currency | undefined => {
  if (!value) {
    return undefined;
  }

  if (value === Currency.BTC || value === Currency.ETH || value === Currency.USDT || value === Currency.USDC) {
    return value;
  }

  return undefined;
};

export class RouletteWebsocketHub {
  private readonly clients = new Map<string, ClientConnection>();
  private heartbeat?: NodeJS.Timeout;
  private subscriberAttached = false;

  private readonly onSubscriberMessage = (channel: string, raw: string): void => {
    if (channel !== ROULETTE_WS_EVENT_CHANNEL) {
      return;
    }

    try {
      const event = JSON.parse(raw) as RouletteRealtimeEvent;
      this.broadcastLocal(event);
    } catch {
      // Ignore malformed pub/sub payloads.
    }
  };

  public async start(): Promise<void> {
    if (this.heartbeat) {
      return;
    }

    this.heartbeat = setInterval(() => {
      this.clients.forEach((client) => {
        if (!client.isAlive) {
          client.socket.terminate();
          this.clients.delete(client.id);
          return;
        }

        client.isAlive = false;
        try {
          client.socket.ping();
        } catch {
          client.socket.terminate();
          this.clients.delete(client.id);
        }
      });
    }, WS_PING_INTERVAL_MS);

    this.heartbeat.unref();

    await ensureRedisConnections();
    if (!this.subscriberAttached) {
      redisSubscriber.on("message", this.onSubscriberMessage);
      this.subscriberAttached = true;
    }
    await redisSubscriber.subscribe(ROULETTE_WS_EVENT_CHANNEL);
  }

  public async stop(): Promise<void> {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }

    this.clients.forEach((client) => {
      client.socket.close();
    });
    this.clients.clear();

    if (this.subscriberAttached) {
      redisSubscriber.off("message", this.onSubscriberMessage);
      this.subscriberAttached = false;
    }

    if (redisSubscriber.status === "ready") {
      await redisSubscriber.unsubscribe(ROULETTE_WS_EVENT_CHANNEL);
    }
  }

  public attachClient(socket: WebSocket, queryCurrency?: string): void {
    const id = randomUUID();
    const currency = parseCurrencyFilter(queryCurrency);

    const client: ClientConnection = {
      id,
      socket,
      currency,
      isAlive: true
    };

    this.clients.set(id, client);

    socket.on("pong", () => {
      client.isAlive = true;
    });

    socket.on("message", (data: RawData) => {
      this.onMessage(client, data);
    });

    socket.on("close", () => {
      this.clients.delete(id);
    });

    socket.on("error", () => {
      this.clients.delete(id);
      socket.terminate();
    });
  }

  public broadcast(event: RouletteRealtimeEvent): void {
    const payload = JSON.stringify(event);
    void (async () => {
      try {
        await redisPublisher.publish(ROULETTE_WS_EVENT_CHANNEL, payload);
      } catch {
        // Local fallback if Redis pub/sub is temporarily unavailable.
        this.broadcastLocal(event);
      }
    })();
  }

  private broadcastLocal(event: RouletteRealtimeEvent): void {
    const payload = JSON.stringify(event);
    const currency = event.payload.currency;

    this.clients.forEach((client) => {
      if (client.currency && client.currency !== currency) {
        return;
      }

      if (client.socket.readyState !== WebSocket.OPEN) {
        this.clients.delete(client.id);
        return;
      }

      try {
        client.socket.send(payload);
      } catch {
        this.clients.delete(client.id);
        client.socket.terminate();
      }
    });
  }

  private onMessage(client: ClientConnection, raw: RawData): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      (parsed as { type?: string }).type === "ping"
    ) {
      const response = JSON.stringify({
        type: "pong",
        ts: new Date().toISOString()
      });

      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(response);
      }
    }
  }
}

export type { RouletteRealtimeEvent };
