import { Queue } from "bullmq";

import { env } from "../../config/env";

type AuditPayload = {
  type: string;
  actorId?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export const auditQueue = new Queue<AuditPayload, void, "audit">("audit-events", {
  connection: {
    url: env.REDIS_URL
  },
  defaultJobOptions: {
    removeOnComplete: 500,
    removeOnFail: 1000,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 500
    }
  }
});

export const enqueueAuditEvent = async (payload: Omit<AuditPayload, "createdAt">): Promise<void> => {
  await auditQueue.add("audit", {
    ...payload,
    createdAt: new Date().toISOString()
  });
};
