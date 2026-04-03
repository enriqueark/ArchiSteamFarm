import { FastifyPluginAsync } from "fastify";

import { requireAuth } from "../../core/auth";
import { prisma } from "../../infrastructure/db/prisma";
import { getLevelFromXp } from "../progression/service";
import { getProfileSummary } from "../affiliates/service";
import { PLATFORM_VIRTUAL_COIN_SYMBOL } from "../wallets/service";

const COIN_DECIMALS = 100000000n;
const toCoinsString = (atomic: bigint, decimals = 2): string => {
  const sign = atomic < 0n ? "-" : "";
  const abs = atomic < 0n ? -atomic : atomic;
  const whole = abs / COIN_DECIMALS;
  const fractionRaw = (abs % COIN_DECIMALS).toString().padStart(8, "0");
  const fraction = decimals > 0 ? `.${fractionRaw.slice(0, decimals)}` : "";
  return `${sign}${whole.toString()}${fraction}`;
};

const isMissingLevelXpColumnError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("levelxpatomic") ||
    (message.includes("column") && message.includes("users"))
  );
};

const isMissingPublicIdColumnError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.toLowerCase().includes("publicid");
};

const toPublicIdSafe = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "bigint") {
    const converted = Number(value);
    if (Number.isSafeInteger(converted) && converted > 0) {
      return converted;
    }
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
};

const getPublicIdBestEffort = async (userId: string): Promise<number | null> => {
  try {
    const rows = await prisma.$queryRaw<Array<{ publicId: unknown }>>`
      SELECT "publicId"
      FROM "users"
      WHERE id = ${userId}
      LIMIT 1
    `;
    return toPublicIdSafe(rows[0]?.publicId ?? null);
  } catch (error) {
    if (isMissingPublicIdColumnError(error)) {
      return null;
    }
    throw error;
  }
};

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user
      .findUnique({
        where: {
          id: request.user.sub
        },
        select: {
          id: true,
          publicId: true,
          email: true,
          role: true,
          status: true,
          levelXpAtomic: true,
          createdAt: true
        }
      })
      .catch((error) => {
        // Backward compatible fallback for deployments where levelXpAtomic
        // column is not present yet.
        if (isMissingLevelXpColumnError(error)) {
          return prisma.user.findUnique({
            where: {
              id: request.user.sub
            },
            select: {
              id: true,
              email: true,
              role: true,
              status: true,
              createdAt: true
            }
          });
        }
        throw error;
      });

    if (!user) {
      return reply.code(404).send({ message: "User not found" });
    }

    const xpAtomic = "levelXpAtomic" in user ? user.levelXpAtomic : 0n;
    const level = getLevelFromXp(xpAtomic);
    const publicId =
      "publicId" in user
        ? toPublicIdSafe(user.publicId)
        : await getPublicIdBestEffort(request.user.sub);

    return reply.send({
      id: user.id,
      publicId,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      level,
      levelXpAtomic: xpAtomic.toString(),
      levelXp: toCoinsString(xpAtomic, 0),
      progression: {
        level,
        xpAtomic: xpAtomic.toString(),
        xp: toCoinsString(xpAtomic, 0),
        currency: PLATFORM_VIRTUAL_COIN_SYMBOL
      }
    });
  });

  fastify.get("/profile/summary", { preHandler: requireAuth }, async (request, reply) => {
    const summary = await getProfileSummary(request.user.sub);
    return reply.send(summary);
  });
};
