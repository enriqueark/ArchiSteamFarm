import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import { AppError } from "../../core/errors";
import { MAX_CHAT_MESSAGE_LENGTH, clearAllChatMessages, listRecentChatMessages, postChatMessage } from "./service";
import { settleEndedRainRounds } from "../chat-tips-rain/service";
import { getRouletteBroadcaster } from "../roulette/service";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const createMessageSchema = z.object({
  message: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_LENGTH)
});

export const chatRoutes: FastifyPluginAsync = async (fastify) => {
  let lastHourlyClearAt = Date.now();
  const HOURLY_CLEAR_MS = 60 * 60 * 1000;
  const maybeRunHourlyClear = async (): Promise<void> => {
    const now = Date.now();
    await settleEndedRainRounds();
    if (now - lastHourlyClearAt < HOURLY_CLEAR_MS) {
      return;
    }

    lastHourlyClearAt = now;
    await clearAllChatMessages();
    getRouletteBroadcaster()?.broadcast({
      type: "chat.cleared",
      data: {
        reason: "HOURLY_RESET",
        clearedAt: new Date(now).toISOString()
      }
    });
  };

  fastify.get("/messages", async (request, reply) => {
    await maybeRunHourlyClear();
    const query = listQuerySchema.parse(request.query);
    const messages = await listRecentChatMessages(query.limit);
    return reply.send(messages);
  });

  fastify.post("/messages", { preHandler: requireAuth }, async (request, reply) => {
    await maybeRunHourlyClear();
    const body = createMessageSchema.parse(request.body);
    if (body.message.trim().toLowerCase() === "!clearchat") {
      if (request.user.role !== "ADMIN") {
        throw new AppError("Only ADMIN can clear chat", 403, "CHAT_CLEAR_FORBIDDEN");
      }

      await clearAllChatMessages();
      getRouletteBroadcaster()?.broadcast({
        type: "chat.cleared",
        data: {
          clearedByUserId: request.user.sub,
          reason: "ADMIN_COMMAND",
          clearedAt: new Date().toISOString()
        }
      });
      return reply.code(200).send({ ok: true, cleared: true });
    }

    const created = await postChatMessage({ userId: request.user.sub, message: body.message });
    getRouletteBroadcaster()?.broadcast({
      type: "chat.message",
      data: {
        id: created.id,
        userId: created.userId,
        userLabel: created.username,
        level: created.userLevel,
        avatarUrl: created.avatarUrl,
        message: created.message,
        createdAt: created.createdAt.toISOString()
      }
    });
    return reply.code(201).send(created);
  });
};
