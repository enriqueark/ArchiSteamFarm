import { env } from "./config/env";
import { redis } from "./infrastructure/cache/redis";
import { closePrismaPool, prisma } from "./infrastructure/db/prisma";
import { auditQueue } from "./infrastructure/queue/audit-queue";
import { buildApp } from "./app";

const app = buildApp();

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "Shutting down application");

  try {
    await app.close();
    await auditQueue.close();
    await prisma.$disconnect();
    await closePrismaPool();

    if (redis.status !== "end") {
      await redis.quit();
    }

    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "Error during shutdown");
    process.exit(1);
  }
};

const run = async (): Promise<void> => {
  try {
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

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void run();
