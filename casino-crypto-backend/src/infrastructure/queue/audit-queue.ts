import { FastifyBaseLogger } from "fastify";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";

import { env } from "../../config/env";

type AuditPayload = {
  type: string;
  actorId?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

const AUDIT_QUEUE_ENQUEUE_TIMEOUT_MS = 2_500;
const AUDIT_QUEUE_WORKER_READY_TIMEOUT_MS = 20_000;
const AUDIT_QUEUE_JOB_TIMEOUT_MS = 15_000;
const AUDIT_WORKER_CONCURRENCY = 32;
const AUDIT_WORKER_DISABLE_ON_ERROR_MS = 60_000;

const createBullConnection = () => ({
  url: env.REDIS_URL,
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  connectTimeout: 20_000,
  commandTimeout: 30_000
});

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("AUDIT_QUEUE_TIMEOUT"));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

export const auditQueue = new Queue<AuditPayload, void, "audit">("audit-events", {
  connection: createBullConnection(),
  defaultJobOptions: {
    removeOnComplete: 500,
    removeOnFail: 1000,
    attempts: 5,
    timeout: AUDIT_QUEUE_JOB_TIMEOUT_MS,
    backoff: {
      type: "exponential",
      delay: 1_000
    }
  }
});

auditQueue.on("error", () => {
  // Audit queue is best-effort; avoid crashing request flow on Redis outages.
});

let auditWorker: Worker<AuditPayload, void, "audit"> | null = null;
let workerDisabledUntil = 0;

const isTransientRedisError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("Command timed out") ||
    error.message.includes("ECONNREFUSED") ||
    error.message.includes("ETIMEDOUT")
  );
};

export const startAuditQueueWorker = async (logger: FastifyBaseLogger): Promise<void> => {
  if (Date.now() < workerDisabledUntil) {
    logger.warn("Audit queue worker start skipped due to recent Redis failures");
    return;
  }

  if (auditWorker) {
    return;
  }

  const probe = new Redis(createBullConnection());
  try {
    await withTimeout(probe.ping(), 1_500);
  } catch (error) {
    workerDisabledUntil = Date.now() + AUDIT_WORKER_DISABLE_ON_ERROR_MS;
    logger.warn({ err: error }, "Audit queue worker skipped because Redis is unreachable");
    return;
  } finally {
    probe.disconnect();
  }

  auditWorker = new Worker<AuditPayload, void, "audit">(
    "audit-events",
    async (job) => {
      // Replace with durable sink forwarding if needed.
      logger.debug(
        {
          jobId: job.id,
          type: job.data.type,
          actorId: job.data.actorId,
          targetId: job.data.targetId
        },
        "Audit event processed"
      );
    },
    {
      connection: createBullConnection(),
      concurrency: AUDIT_WORKER_CONCURRENCY,
      lockDuration: 30_000,
      stalledInterval: 30_000
    }
  );

  auditWorker.on("failed", (job, error) => {
    logger.error({ err: error, jobId: job?.id }, "Audit queue job failed");
  });

  auditWorker.on("error", (error) => {
    logger.error({ err: error }, "Audit queue worker error");
    if (isTransientRedisError(error)) {
      workerDisabledUntil = Date.now() + AUDIT_WORKER_DISABLE_ON_ERROR_MS;
    }
  });

  try {
    await withTimeout(auditWorker.waitUntilReady(), AUDIT_QUEUE_WORKER_READY_TIMEOUT_MS);
  } catch (error) {
    workerDisabledUntil = Date.now() + AUDIT_WORKER_DISABLE_ON_ERROR_MS;
    await stopAuditQueueWorker();
    throw error;
  }
};

export const stopAuditQueueWorker = async (): Promise<void> => {
  if (!auditWorker) {
    return;
  }

  await auditWorker.close();
  auditWorker = null;
};

export const enqueueAuditEvent = async (payload: Omit<AuditPayload, "createdAt">): Promise<void> => {
  try {
    await withTimeout(
      auditQueue.add("audit", {
        ...payload,
        createdAt: new Date().toISOString()
      }),
      AUDIT_QUEUE_ENQUEUE_TIMEOUT_MS
    );
  } catch {
    // Best-effort path; drop audit event instead of blocking user flow.
  }
};
