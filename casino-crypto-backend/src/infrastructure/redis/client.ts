import Redis from "ioredis";

import { env } from "../../config/env";

type RedisGlobals = {
  redis?: Redis;
  redisPublisher?: Redis;
  redisSubscriber?: Redis;
};

const globals = globalThis as unknown as RedisGlobals;

const createClient = (): Redis =>
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true
  });

export const redis = globals.redis ?? createClient();
export const redisPublisher = globals.redisPublisher ?? createClient();
export const redisSubscriber = globals.redisSubscriber ?? createClient();

export const ensureRedisConnections = async (): Promise<void> => {
  const clients = [redis, redisPublisher, redisSubscriber];
  await Promise.all(
    clients.map(async (client) => {
      if (client.status === "wait") {
        await client.connect();
      }
    })
  );
};

export const closeRedisConnections = async (): Promise<void> => {
  await Promise.all(
    [redis, redisPublisher, redisSubscriber].map(async (client) => {
      if (client.status === "wait") {
        client.disconnect();
        return;
      }

      if (client.status !== "end") {
        await client.quit();
      }
    })
  );
};

if (env.NODE_ENV !== "production") {
  globals.redis = redis;
  globals.redisPublisher = redisPublisher;
  globals.redisSubscriber = redisSubscriber;
}
