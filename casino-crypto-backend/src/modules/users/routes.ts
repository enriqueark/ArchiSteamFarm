import { Prisma } from "@prisma/client";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import { prisma } from "../../infrastructure/db/prisma";
import { getLevelFromXp } from "../progression/service";
import { getProfileSummary } from "../affiliates/service";
import { PLATFORM_INTERNAL_CURRENCY, PLATFORM_VIRTUAL_COIN_SYMBOL } from "../wallets/service";

const COIN_DECIMALS = 100000000n;
const toCoinsString = (atomic: bigint, decimals = 2): string => {
  const sign = atomic < 0n ? "-" : "";
  const abs = atomic < 0n ? -atomic : atomic;
  const whole = abs / COIN_DECIMALS;
  const fractionRaw = (abs % COIN_DECIMALS).toString().padStart(8, "0");
  const fraction = decimals > 0 ? `.${fractionRaw.slice(0, decimals)}` : "";
  return `${sign}${whole.toString()}${fraction}`;
};

const transactionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

const gameHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  mode: z
    .enum(["ALL", "MINES", "BLACKJACK", "ROULETTE", "CASES", "BATTLES"])
    .default("ALL")
});

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

const parseMetadataRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const transactionKindFromReason = (
  reason: string,
  direction: "CREDIT" | "DEBIT"
): "DEPOSIT" | "WITHDRAWAL" | "ADMIN" | "TIP_SENT" | "TIP_RECEIVED" | "RAIN_TIP" | "RAIN_PAYOUT" | "GAME" | "VAULT" | "OTHER" => {
  if (reason === "DEPOSIT") return "DEPOSIT";
  if (reason === "WITHDRAWAL" || reason === "WITHDRAWAL_FEE") return "WITHDRAWAL";
  if (reason === "ADMIN_ADJUSTMENT") return "ADMIN";
  if (reason === "USER_TIP") return direction === "DEBIT" ? "TIP_SENT" : "TIP_RECEIVED";
  if (reason === "RAIN_TIP") return "RAIN_TIP";
  if (reason === "RAIN_PAYOUT") return "RAIN_PAYOUT";
  if (reason === "VAULT_DEPOSIT" || reason === "VAULT_WITHDRAW") return "VAULT";
  if (reason === "BET_HOLD" || reason === "BET_RELEASE" || reason === "BET_CAPTURE" || reason === "BET_PAYOUT") {
    return "GAME";
  }
  return "OTHER";
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

  fastify.get("/me/transactions", { preHandler: requireAuth }, async (request, reply) => {
    const query = transactionsQuerySchema.parse(request.query);
    const wallet = await prisma.wallet.findUnique({
      where: {
        userId_currency: {
          userId: request.user.sub,
          currency: PLATFORM_INTERNAL_CURRENCY
        }
      },
      select: { id: true }
    });

    if (!wallet) {
      return reply.send({
        items: [],
        pagination: {
          limit: query.limit,
          offset: query.offset,
          total: 0,
          hasMore: false
        }
      });
    }

    const [total, entries] = await Promise.all([
      prisma.ledgerEntry.count({
        where: {
          walletId: wallet.id
        }
      }),
      prisma.ledgerEntry.findMany({
        where: {
          walletId: wallet.id
        },
        orderBy: {
          createdAt: "desc"
        },
        take: query.limit,
        skip: query.offset
      })
    ]);

    const relatedUserIds = new Set<string>();
    for (const entry of entries) {
      const metadata = parseMetadataRecord(entry.metadata);
      const fromUserId = typeof metadata?.fromUserId === "string" ? metadata.fromUserId : null;
      const toUserId = typeof metadata?.toUserId === "string" ? metadata.toUserId : null;
      if (fromUserId) relatedUserIds.add(fromUserId);
      if (toUserId) relatedUserIds.add(toUserId);
    }

    const usersById =
      relatedUserIds.size > 0
        ? await prisma.user.findMany({
            where: {
              id: { in: [...relatedUserIds] }
            },
            select: {
              id: true,
              publicId: true,
              email: true
            }
          })
        : [];
    const userMap = new Map(
      usersById.map((user) => [
        user.id,
        {
          id: user.id,
          publicId: user.publicId,
          label: user.email.split("@")[0] || `user#${user.publicId ?? "?"}`
        }
      ])
    );

    return reply.send({
      items: entries.map((entry) => {
        const metadata = parseMetadataRecord(entry.metadata);
        const fromUserId = typeof metadata?.fromUserId === "string" ? metadata.fromUserId : null;
        const toUserId = typeof metadata?.toUserId === "string" ? metadata.toUserId : null;
        const gameType = typeof metadata?.gameType === "string" ? metadata.gameType : null;
        return {
          id: entry.id,
          kind: transactionKindFromReason(entry.reason, entry.direction),
          direction: entry.direction,
          reason: entry.reason,
          amountAtomic: entry.amountAtomic.toString(),
          amountCoins: toCoinsString(entry.amountAtomic),
          balanceBeforeAtomic: entry.balanceBeforeAtomic.toString(),
          balanceBeforeCoins: toCoinsString(entry.balanceBeforeAtomic),
          balanceAfterAtomic: entry.balanceAfterAtomic.toString(),
          balanceAfterCoins: toCoinsString(entry.balanceAfterAtomic),
          referenceId: entry.referenceId,
          gameType,
          counterpartyFrom: fromUserId ? userMap.get(fromUserId) ?? null : null,
          counterpartyTo: toUserId ? userMap.get(toUserId) ?? null : null,
          metadata: entry.metadata,
          createdAt: entry.createdAt
        };
      }),
      pagination: {
        limit: query.limit,
        offset: query.offset,
        total,
        hasMore: query.offset + entries.length < total
      }
    });
  });

  fastify.get("/me/game-history", { preHandler: requireAuth }, async (request, reply) => {
    const query = gameHistoryQuerySchema.parse(request.query);
    const modeFilterSql =
      query.mode === "ALL" ? Prisma.empty : Prisma.sql`WHERE "gameMode" = ${query.mode}`;

    const totalRows = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS total
      FROM (
        SELECT 'MINES'::text AS "gameMode", "createdAt" AS "playedAt"
        FROM "mines_games"
        WHERE "userId" = ${request.user.sub}
        UNION ALL
        SELECT 'BLACKJACK'::text AS "gameMode", "createdAt" AS "playedAt"
        FROM "blackjack_games"
        WHERE "userId" = ${request.user.sub}
        UNION ALL
        SELECT 'ROULETTE'::text AS "gameMode", "createdAt" AS "playedAt"
        FROM "roulette_bets"
        WHERE "userId" = ${request.user.sub}
        UNION ALL
        SELECT 'CASES'::text AS "gameMode", "createdAt" AS "playedAt"
        FROM "case_openings"
        WHERE "userId" = ${request.user.sub}
        UNION ALL
        SELECT 'BATTLES'::text AS "gameMode", COALESCE(bs."joinedAt", bs."createdAt") AS "playedAt"
        FROM "battle_slots" bs
        WHERE bs."userId" = ${request.user.sub}
          AND bs."paidAmountAtomic" > 0
      ) AS "historyBase"
      ${modeFilterSql}
    `);
    const total = Number(totalRows[0]?.total ?? 0n);

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        gameMode: "MINES" | "BLACKJACK" | "ROULETTE" | "CASES" | "BATTLES";
        status: string;
        playedAt: Date;
        wagerAtomic: bigint;
        payoutAtomic: bigint;
        profitAtomic: bigint;
        reference: string | null;
      }>
    >(Prisma.sql`
      SELECT *
      FROM (
        SELECT
          mg.id::text AS id,
          'MINES'::text AS "gameMode",
          mg.status::text AS status,
          mg."createdAt" AS "playedAt",
          mg."betAtomic" AS "wagerAtomic",
          COALESCE(mg."payoutAtomic", 0)::bigint AS "payoutAtomic",
          (COALESCE(mg."payoutAtomic", 0) - mg."betAtomic")::bigint AS "profitAtomic",
          mg.id::text AS reference
        FROM "mines_games" mg
        WHERE mg."userId" = ${request.user.sub}

        UNION ALL

        SELECT
          bj.id::text AS id,
          'BLACKJACK'::text AS "gameMode",
          bj.status::text AS status,
          bj."createdAt" AS "playedAt",
          bj."initialBetAtomic" AS "wagerAtomic",
          COALESCE(bj."payoutAtomic", 0)::bigint AS "payoutAtomic",
          (COALESCE(bj."payoutAtomic", 0) - bj."initialBetAtomic")::bigint AS "profitAtomic",
          bj.id::text AS reference
        FROM "blackjack_games" bj
        WHERE bj."userId" = ${request.user.sub}

        UNION ALL

        SELECT
          rb.id::text AS id,
          'ROULETTE'::text AS "gameMode",
          rb.status::text AS status,
          rb."createdAt" AS "playedAt",
          rb."stakeAtomic" AS "wagerAtomic",
          COALESCE(rb."payoutAtomic", 0)::bigint AS "payoutAtomic",
          (COALESCE(rb."payoutAtomic", 0) - rb."stakeAtomic")::bigint AS "profitAtomic",
          rb."roundId"::text AS reference
        FROM "roulette_bets" rb
        WHERE rb."userId" = ${request.user.sub}

        UNION ALL

        SELECT
          co.id::text AS id,
          'CASES'::text AS "gameMode",
          'OPENED'::text AS status,
          co."createdAt" AS "playedAt",
          co."priceAtomic" AS "wagerAtomic",
          COALESCE(co."payoutAtomic", 0)::bigint AS "payoutAtomic",
          co."profitAtomic"::bigint AS "profitAtomic",
          co."caseId"::text AS reference
        FROM "case_openings" co
        WHERE co."userId" = ${request.user.sub}

        UNION ALL

        SELECT
          bs.id::text AS id,
          'BATTLES'::text AS "gameMode",
          b.status::text AS status,
          COALESCE(bs."joinedAt", bs."createdAt") AS "playedAt",
          bs."paidAmountAtomic"::bigint AS "wagerAtomic",
          COALESCE(bs."payoutAtomic", 0)::bigint AS "payoutAtomic",
          bs."profitAtomic"::bigint AS "profitAtomic",
          bs."battleId"::text AS reference
        FROM "battle_slots" bs
        INNER JOIN "battles" b ON b.id = bs."battleId"
        WHERE bs."userId" = ${request.user.sub}
          AND bs."paidAmountAtomic" > 0
      ) AS history
      ${modeFilterSql}
      ORDER BY "playedAt" DESC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `);

    return reply.send({
      items: rows.map((row) => ({
        id: row.id,
        gameMode: row.gameMode,
        status: row.status,
        playedAt: row.playedAt,
        wagerAtomic: row.wagerAtomic.toString(),
        wagerCoins: toCoinsString(row.wagerAtomic),
        payoutAtomic: row.payoutAtomic.toString(),
        payoutCoins: toCoinsString(row.payoutAtomic),
        profitAtomic: row.profitAtomic.toString(),
        profitCoins: toCoinsString(row.profitAtomic),
        reference: row.reference
      })),
      pagination: {
        limit: query.limit,
        offset: query.offset,
        total,
        hasMore: query.offset + rows.length < total
      }
    });
  });
};
