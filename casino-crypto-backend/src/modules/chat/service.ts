import { Prisma } from "@prisma/client";

import { AppError } from "../../core/errors";
import { redis } from "../../infrastructure/cache/redis";
import { prisma } from "../../infrastructure/db/prisma";

export type ChatMessageState = {
  id: string;
  userId: string;
  username: string;
  userLevel: number;
  avatarUrl: string | null;
  message: string;
  createdAt: Date;
};

type PostChatMessageInput = {
  userId: string;
  message: string;
};

export const MAX_CHAT_MESSAGE_LENGTH = 300;
const CHAT_MESSAGE_COOLDOWN_MS = 3_000;
const CHAT_COOLDOWN_KEY_PREFIX = "chat:cooldown";

const formatUsername = (email: string, userId: string): string => {
  const local = email.split("@")[0]?.trim();
  if (local && local.length > 0) {
    return local.slice(0, 24);
  }
  return `user_${userId.slice(0, 8)}`;
};

const normalizeMessage = (value: string): string => {
  return value.replace(/\s+/g, " ").trim();
};

const toState = (row: {
  id: string;
  userId: string;
  message: string;
  createdAt: Date;
  user: {
    email: string;
  };
}): ChatMessageState => ({
  id: row.id,
  userId: row.userId,
  username: formatUsername(row.user.email, row.userId),
  userLevel: 1,
  avatarUrl: null,
  message: row.message,
  createdAt: row.createdAt
});

export const listRecentChatMessages = async (limit: number): Promise<ChatMessageState[]> => {
  const safeLimit = Math.max(1, Math.min(100, limit));
  const rows = await prisma.chatMessage.findMany({
    orderBy: {
      createdAt: "desc"
    },
    take: safeLimit,
    include: {
      user: {
        select: {
          email: true
        }
      }
    }
  });

  return rows.reverse().map(toState);
};

export const postChatMessage = async (input: PostChatMessageInput): Promise<ChatMessageState> => {
  const message = normalizeMessage(input.message);
  if (message.length < 1) {
    throw new AppError("Message cannot be empty", 400, "CHAT_MESSAGE_EMPTY");
  }
  if (message.length > MAX_CHAT_MESSAGE_LENGTH) {
    throw new AppError(
      `Message cannot exceed ${MAX_CHAT_MESSAGE_LENGTH} characters`,
      400,
      "CHAT_MESSAGE_TOO_LONG"
    );
  }

  const cooldownKey = `${CHAT_COOLDOWN_KEY_PREFIX}:${input.userId}`;
  const lockResult = await redis.set(cooldownKey, "1", "PX", CHAT_MESSAGE_COOLDOWN_MS, "NX");
  if (lockResult !== "OK") {
    const ttlMs = await redis.pttl(cooldownKey).catch(() => CHAT_MESSAGE_COOLDOWN_MS);
    const retryAfterMs = ttlMs > 0 ? ttlMs : CHAT_MESSAGE_COOLDOWN_MS;
    throw new AppError(
      `Wait ${Math.ceil(retryAfterMs / 1000)}s before sending another message`,
      429,
      "CHAT_RATE_LIMITED",
      { retryAfterMs }
    );
  }

  try {
    const row = await prisma.chatMessage.create({
      data: {
        userId: input.userId,
        message
      },
      include: {
        user: {
          select: {
            email: true
          }
        }
      }
    });
    return toState(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Unable to create chat message", 400, "CHAT_MESSAGE_CREATE_FAILED");
    }
    throw error;
  }
};
