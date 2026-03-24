import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import { MAX_CHAT_MESSAGE_LENGTH, listRecentChatMessages, postChatMessage } from "./service";
import { getRouletteBroadcaster } from "../roulette/service";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const createMessageSchema = z.object({
  message: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_LENGTH)
});

export const chatRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/messages", async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const messages = await listRecentChatMessages(query.limit);
    return reply.send(messages);
  });

  fastify.post("/messages", { preHandler: requireAuth }, async (request, reply) => {
    const body = createMessageSchema.parse(request.body);
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
