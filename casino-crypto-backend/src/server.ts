import { env } from "./config/env";
import { closeRedisConnections } from "./infrastructure/redis/client";
import { closePrismaPool, prisma } from "./infrastructure/db/prisma";
import { auditQueue, startAuditQueueWorker, stopAuditQueueWorker } from "./infrastructure/queue/audit-queue";
import { buildApp } from "./app";

const app = buildApp();
const SHUTDOWN_TIMEOUT_MS = 8_000;
let isShuttingDown = false;

const withTimeout = async <T>(operation: Promise<T>, label: string, timeoutMs = SHUTDOWN_TIMEOUT_MS): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const shutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  app.log.info({ signal }, "Shutting down application");

  try {
    await withTimeout(app.close(), "app.close");
    await withTimeout(stopAuditQueueWorker(), "auditQueue.worker.close");
    await withTimeout(auditQueue.close(), "auditQueue.close");
    await withTimeout(prisma.$disconnect(), "prisma.disconnect");
    await withTimeout(closePrismaPool(), "prisma.pool.close");
    await withTimeout(closeRedisConnections(), "redis.close");

    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "Error during shutdown");
    process.exit(1);
  }
};

const run = async (): Promise<void> => {
  try {
    try {
      await withTimeout(startAuditQueueWorker(app.log), "auditQueue.worker.start", 20_000);
    } catch (error) {
      app.log.warn({ err: error }, "Audit queue worker start timed out; continuing without local worker");
    }

    await app.listen({
      host: env.HOST,
      port: env.PORT
    });

    app.log.info(`API running on http://${env.HOST}:${env.PORT}`);
  } catch (error) {
    app.log.error({ err: error }, "Failed to start server");
    process.exit(1);
  }
};

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void run();
