import argon2 from "argon2";
import bcrypt from "bcryptjs";
import { DepositStatus, Prisma, WithdrawalStatus } from "@prisma/client";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";
import { findClosestCatalogSkinByValueAtomic } from "../cases/service";
import { getLevelFromXp } from "../progression/service";
import { getProfileSummary, setProfileVisibility } from "../affiliates/service";
import { verifyTwoFactorCode } from "../security-2fa/service";
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
const winsTickerQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(40).default(12)
});
const profileVisibilitySchema = z.object({
  profileVisible: z.boolean()
});
const publicProfileParamsSchema = z.object({
  publicId: z.coerce.number().int().min(1)
});
const publicProfileByUserIdParamsSchema = z.object({
  userId: z.string().cuid()
});
const avatarUpdateSchema = z.object({
  avatarUrl: z
    .union([z.string().trim().max(1024), z.null()])
    .optional()
    .transform((value) => {
      if (typeof value !== "string") {
        return null;
      }
      const normalized = value.trim();
      return normalized.length > 0 ? normalized : null;
    })
    .refine(
      (value) => {
        if (!value) {
          return true;
        }
        try {
          const url = new URL(value);
          return url.protocol === "http:" || url.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "avatarUrl must be a valid http/https URL" }
    )
});

const notificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10)
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(8).max(128),
    twoFactorCode: z.string().trim().regex(/^\d{6}$/).optional()
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    path: ["newPassword"],
    message: "New password must be different from current password"
  });

const updateTradeUrlSchema = z.object({
  tradeUrl: z
    .string()
    .trim()
    .max(1024)
    .refine((value) => value.length > 0, "Steam trade URL is required")
    .refine((value) => {
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:") return false;
        if (!/steamcommunity\.com$/i.test(parsed.hostname)) return false;
        if (!/\/tradeoffer\/new\/?/i.test(parsed.pathname)) return false;
        const partner = parsed.searchParams.get("partner")?.trim() ?? "";
        const token = parsed.searchParams.get("token")?.trim() ?? "";
        return /^\d+$/.test(partner) && token.length >= 5;
      } catch {
        return false;
      }
    }, "Please enter a valid Steam trade URL")
});

const setSelfExclusionSchema = z.object({
  durationDays: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14), z.literal(30)]),
  confirmationText: z.string().trim().min(6).max(300),
  noWager: z.boolean().default(true),
  noWithdraw: z.boolean().default(true),
  noTip: z.boolean().default(true)
});

const updateUsernameSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(/^[a-zA-Z0-9_.-]+$/, "Username can only contain letters, numbers, dots, hyphens and underscores")
});

const USERNAME_CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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

const isMissingAvatarColumnsError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("avatarurl") || message.includes("provideravatarurl");
};

const isMissingUsernameColumnError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.toLowerCase().includes("username");
};

const isMissingSelfExclusionColumnError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("selfexcludeduntil") ||
    message.includes("selfexcludeuntil") ||
    message.includes("selfexclusionnote") ||
    message.includes("selfexclusionreason")
  );
};

const normalizeUsername = (value: string): string => value.trim();

const normalizeSteamTradeUrl = (value: string): string => value.trim();

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

const parseAmountNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
};

const formatAssetAmount = (value: number): string => {
  const fixed = value.toFixed(8);
  return fixed.replace(/\.?0+$/, "");
};

const resolveDepositAssetAmount = (metadata: unknown): number | null => {
  const root = parseMetadataRecord(metadata);
  if (!root) {
    return null;
  }
  const raw = parseMetadataRecord(root.raw);
  if (!raw) {
    return null;
  }
  const txs = Array.isArray(raw.txs) ? raw.txs : [];
  const firstTx = txs.length > 0 ? parseMetadataRecord(txs[0]) : null;
  return (
    parseAmountNumber(firstTx?.sent_amount) ??
    parseAmountNumber(raw.amount) ??
    parseAmountNumber(firstTx?.value) ??
    parseAmountNumber(raw.value)
  );
};

const resolveWithdrawalAssetAmount = (metadata: unknown): number | null => {
  const root = parseMetadataRecord(metadata);
  if (!root) {
    return null;
  }
  return parseAmountNumber(root.payoutAmountAsset);
};

const formatUserLabel = (username: string | null | undefined, email: string): string => {
  const normalized = (typeof username === "string" ? username.trim() : "") || email.split("@")[0]?.trim() || "player";
  return normalized.slice(0, 24);
};

const formatWinMultiplier = (wagerAtomic: bigint, payoutAtomic: bigint): string | null => {
  if (wagerAtomic <= 0n || payoutAtomic <= 0n) return null;
  const ratio = Number(payoutAtomic) / Number(wagerAtomic);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return `x${ratio.toFixed(2)}`;
};

type WinsTickerItem = {
  id: string;
  mode: "MINES" | "CASES" | "BATTLES";
  modeLabel: string;
  route: string;
  occurredAt: string;
  user: {
    publicId: number | null;
    username: string;
  };
  skin: {
    name: string;
    imageUrl: string | null;
    valueAtomic: string;
    valueCoins: string;
  };
  multiplier: string | null;
};

const getWinsTickerFeed = async (limit: number): Promise<WinsTickerItem[]> => {
  const safeLimit = Math.max(1, Math.min(40, Math.trunc(limit)));
  const perModeLimit = Math.min(40, safeLimit * 3);

  const [minesWins, casesWins, battleWins] = await Promise.all([
    prisma.minesGame.findMany({
      where: {
        status: "CASHED_OUT",
        payoutAtomic: { gt: 0n },
        finishedAt: { not: null },
        currency: PLATFORM_INTERNAL_CURRENCY
      },
      orderBy: [{ finishedAt: "desc" }],
      take: perModeLimit,
      select: {
        id: true,
        betAtomic: true,
        payoutAtomic: true,
        finishedAt: true,
        user: {
          select: {
            publicId: true,
            username: true,
            email: true
          }
        }
      }
    }),
    prisma.caseOpening.findMany({
      where: {
        payoutAtomic: { gt: 0n },
        currency: PLATFORM_INTERNAL_CURRENCY
      },
      orderBy: [{ createdAt: "desc" }],
      take: perModeLimit,
      select: {
        id: true,
        priceAtomic: true,
        payoutAtomic: true,
        createdAt: true,
        user: {
          select: {
            publicId: true,
            username: true,
            email: true
          }
        },
        caseItem: {
          select: {
            name: true,
            imageUrl: true,
            valueAtomic: true
          }
        }
      }
    }),
    prisma.battleItemDrop.findMany({
      where: {
        battleSlot: {
          userId: { not: null },
          paidAmountAtomic: { gt: 0n }
        },
        valueAtomic: { gt: 0n }
      },
      orderBy: [{ createdAt: "desc" }],
      take: perModeLimit,
      select: {
        id: true,
        valueAtomic: true,
        createdAt: true,
        battleSlot: {
          select: {
            paidAmountAtomic: true,
            user: {
              select: {
                publicId: true,
                username: true,
                email: true
              }
            }
          }
        },
        caseItem: {
          select: {
            name: true,
            imageUrl: true
          }
        }
      }
    })
  ]);

  const minesItems = await Promise.all(
    minesWins.map(async (row): Promise<WinsTickerItem | null> => {
      const payoutAtomic = row.payoutAtomic ?? 0n;
      if (payoutAtomic <= 0n || !row.finishedAt) return null;
      const previewSkin = await findClosestCatalogSkinByValueAtomic({
        valueAtomic: payoutAtomic
      });
      if (!previewSkin) return null;
      const username = formatUserLabel(row.user.username, row.user.email);
      return {
        id: `MINES:${row.id}`,
        mode: "MINES",
        modeLabel: "Mines",
        route: "/mines",
        occurredAt: row.finishedAt.toISOString(),
        user: {
          publicId: row.user.publicId ?? null,
          username
        },
        skin: {
          name: previewSkin.name,
          imageUrl: previewSkin.imageUrl,
          valueAtomic: previewSkin.valueAtomic.toString(),
          valueCoins: toCoinsString(previewSkin.valueAtomic)
        },
        multiplier: formatWinMultiplier(row.betAtomic, payoutAtomic)
      };
    })
  );

  const caseItems = casesWins.map((row): WinsTickerItem => {
    const username = formatUserLabel(row.user.username, row.user.email);
    return {
      id: `CASES:${row.id}`,
      mode: "CASES",
      modeLabel: "Cases",
      route: "/cases",
      occurredAt: row.createdAt.toISOString(),
      user: {
        publicId: row.user.publicId ?? null,
        username
      },
      skin: {
        name: row.caseItem.name,
        imageUrl: row.caseItem.imageUrl,
        valueAtomic: row.caseItem.valueAtomic.toString(),
        valueCoins: toCoinsString(row.caseItem.valueAtomic)
      },
      multiplier: formatWinMultiplier(row.priceAtomic, row.payoutAtomic)
    };
  });

  const battleItems = battleWins
    .map((row): WinsTickerItem | null => {
      const user = row.battleSlot.user;
      if (!user) return null;
      const username = formatUserLabel(user.username, user.email);
      return {
        id: `BATTLES:${row.id}`,
        mode: "BATTLES",
        modeLabel: "Case Battles",
        route: "/case-battles",
        occurredAt: row.createdAt.toISOString(),
        user: {
          publicId: user.publicId ?? null,
          username
        },
        skin: {
          name: row.caseItem.name,
          imageUrl: row.caseItem.imageUrl,
          valueAtomic: row.valueAtomic.toString(),
          valueCoins: toCoinsString(row.valueAtomic)
        },
        multiplier: formatWinMultiplier(row.battleSlot.paidAmountAtomic, row.valueAtomic)
      };
    })
    .filter((item): item is WinsTickerItem => item !== null);

  return [...minesItems.filter((item): item is WinsTickerItem => item !== null), ...caseItems, ...battleItems]
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, safeLimit);
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

const toOptionalString = (value: unknown): string | null => {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const resolveAvatarUrl = (avatarUrl: string | null, providerAvatarUrl: string | null): string | null => {
  return avatarUrl ?? providerAvatarUrl ?? null;
};

const resolveAvatarSource = (
  avatarUrl: string | null,
  providerAvatarUrl: string | null
): "CUSTOM" | "PROVIDER" | "INITIAL" => {
  if (avatarUrl) {
    return "CUSTOM";
  }
  if (providerAvatarUrl) {
    return "PROVIDER";
  }
  return "INITIAL";
};

const isBcryptHash = (hash: string): boolean => /^\$2[aby]\$/.test(hash);

const verifyPasswordWithLegacySupport = async (
  storedHash: string,
  inputPassword: string
): Promise<boolean> => {
  try {
    return await argon2.verify(storedHash, inputPassword);
  } catch {
    // continue fallback checks
  }

  if (isBcryptHash(storedHash)) {
    return bcrypt.compare(inputPassword, storedHash).catch(() => false);
  }

  // Legacy fallback for historical plain-text rows.
  return storedHash === inputPassword;
};

const ensureUserAvatarColumnsBestEffort = async (): Promise<void> => {
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT');
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "providerAvatarUrl" TEXT');
  } catch {
    // ignored
  }
};

const ensureProfileControlColumnsBestEffort = async (): Promise<void> => {
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "steamTradeUrl" TEXT');
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "usernameChangedAt" TIMESTAMP(3)');
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "usernameUpdatedAt" TIMESTAMP(3)');
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "selfExcludeUntil" TIMESTAMP(3)');
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "selfExcludedUntil" TIMESTAMP(3)');
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "selfExclusionReason" TEXT');
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "selfExclusionNoWager" BOOLEAN NOT NULL DEFAULT true'
    );
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "selfExclusionNoWithdraw" BOOLEAN NOT NULL DEFAULT true'
    );
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "selfExclusionNoTip" BOOLEAN NOT NULL DEFAULT true'
    );
  } catch {
    // ignored
  }
};

const getUserAvatarSourcesBestEffort = async (
  userId: string
): Promise<{ avatarUrl: string | null; providerAvatarUrl: string | null }> => {
  try {
    const rows = await prisma.$queryRaw<Array<{ avatarUrl: unknown; providerAvatarUrl: unknown }>>`
      SELECT "avatarUrl", "providerAvatarUrl"
      FROM "users"
      WHERE id = ${userId}
      LIMIT 1
    `;
    return {
      avatarUrl: toOptionalString(rows[0]?.avatarUrl ?? null),
      providerAvatarUrl: toOptionalString(rows[0]?.providerAvatarUrl ?? null)
    };
  } catch (error) {
    if (isMissingAvatarColumnsError(error)) {
      return {
        avatarUrl: null,
        providerAvatarUrl: null
      };
    }
    throw error;
  }
};

const updateUserAvatarBestEffort = async (
  userId: string,
  avatarUrl: string | null
): Promise<{ avatarUrl: string | null; providerAvatarUrl: string | null; updatedAt: Date }> => {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ avatarUrl: unknown; providerAvatarUrl: unknown; updatedAt: Date }>
    >`
      UPDATE "users"
      SET "avatarUrl" = ${avatarUrl},
          "updatedAt" = NOW()
      WHERE id = ${userId}
      RETURNING "avatarUrl", "providerAvatarUrl", "updatedAt"
    `;
    const row = rows[0];
    if (!row) {
      throw new Error("USER_NOT_FOUND");
    }
    return {
      avatarUrl: toOptionalString(row.avatarUrl ?? null),
      providerAvatarUrl: toOptionalString(row.providerAvatarUrl ?? null),
      updatedAt: row.updatedAt
    };
  } catch (error) {
    if (isMissingAvatarColumnsError(error)) {
      return {
        avatarUrl: null,
        providerAvatarUrl: null,
        updatedAt: new Date()
      };
    }
    throw error;
  }
};

const tradeUrlSchema = updateTradeUrlSchema;

type PublicChatProfileSummary = {
  user: {
    id: string;
    publicId: number | null;
    username: string;
    level: number;
    profileVisible: boolean;
  };
  stats: {
    rewardsRedeemedAtomic: string;
    rewardsRedeemedCoins: string;
    wageredTotalAtomic: string;
    wageredTotalCoins: string;
    wageredByMode: {
      caseBattlesAtomic: string;
      caseBattlesCoins: string;
      caseOpeningAtomic: string;
      caseOpeningCoins: string;
      minesAtomic: string;
      minesCoins: string;
      blackjackAtomic: string;
      blackjackCoins: string;
      rouletteAtomic: string;
      rouletteCoins: string;
    };
    maxSingleWinAtomic: string;
    maxSingleWinCoins: string;
    maxSingleMultiplier: string;
    currency: string;
  };
};

const getPublicChatProfileSummary = async (publicId: number): Promise<PublicChatProfileSummary> => {
  const user = await prisma.user.findUnique({
    where: { publicId },
    select: {
      id: true,
      publicId: true,
      email: true,
      profileVisible: true,
      levelXpAtomic: true
    }
  });
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const username = user.email.split("@")[0] || `user#${user.publicId ?? "?"}`;
  const level = getLevelFromXp(user.levelXpAtomic);
  if (!user.profileVisible) {
    return {
      user: {
        id: user.id,
        publicId: user.publicId ?? null,
        username,
        level,
        profileVisible: false
      },
      stats: {
        rewardsRedeemedAtomic: "0",
        rewardsRedeemedCoins: "0.00",
        wageredTotalAtomic: "0",
        wageredTotalCoins: "0.00",
        wageredByMode: {
          caseBattlesAtomic: "0",
          caseBattlesCoins: "0.00",
          caseOpeningAtomic: "0",
          caseOpeningCoins: "0.00",
          minesAtomic: "0",
          minesCoins: "0.00",
          blackjackAtomic: "0",
          blackjackCoins: "0.00",
          rouletteAtomic: "0",
          rouletteCoins: "0.00"
        },
        maxSingleWinAtomic: "0",
        maxSingleWinCoins: "0.00",
        maxSingleMultiplier: "0.00",
        currency: PLATFORM_VIRTUAL_COIN_SYMBOL
      }
    };
  }

  const [minesAgg, blackjackAgg, rouletteAgg, caseOpeningsAgg, battleSlotsAgg, bestWin] = await Promise.all([
    prisma.minesGame.aggregate({
      where: { userId: user.id, currency: PLATFORM_INTERNAL_CURRENCY },
      _sum: { betAtomic: true }
    }),
    prisma.blackjackGame.aggregate({
      where: { userId: user.id, currency: PLATFORM_INTERNAL_CURRENCY },
      _sum: { initialBetAtomic: true }
    }),
    prisma.rouletteBet.aggregate({
      where: { userId: user.id, currency: PLATFORM_INTERNAL_CURRENCY },
      _sum: { stakeAtomic: true }
    }),
    prisma.caseOpening.aggregate({
      where: { userId: user.id, currency: PLATFORM_INTERNAL_CURRENCY },
      _sum: { priceAtomic: true },
      _max: { profitAtomic: true }
    }),
    prisma.battleSlot.aggregate({
      where: { userId: user.id },
      _sum: { paidAmountAtomic: true },
      _max: { profitAtomic: true }
    }),
    prisma.$queryRaw<
      Array<{
        payoutAtomic: bigint;
        wagerAtomic: bigint;
        multiplierNumerator: bigint;
      }>
    >(Prisma.sql`
      SELECT payout_atomic AS "payoutAtomic",
             wager_atomic AS "wagerAtomic",
             multiplier_numerator AS "multiplierNumerator"
      FROM (
        SELECT
          COALESCE(mg."payoutAtomic", 0)::bigint AS payout_atomic,
          mg."betAtomic"::bigint AS wager_atomic,
          CASE
            WHEN mg."betAtomic" > 0 THEN (COALESCE(mg."payoutAtomic", 0)::bigint * 100000000n) / mg."betAtomic"
            ELSE 0::bigint
          END AS multiplier_numerator
        FROM "mines_games" mg
        WHERE mg."userId" = ${user.id}
          AND mg."currency" = ${PLATFORM_INTERNAL_CURRENCY}

        UNION ALL

        SELECT
          COALESCE(bj."payoutAtomic", 0)::bigint AS payout_atomic,
          bj."initialBetAtomic"::bigint AS wager_atomic,
          CASE
            WHEN bj."initialBetAtomic" > 0 THEN (COALESCE(bj."payoutAtomic", 0)::bigint * 100000000n) / bj."initialBetAtomic"
            ELSE 0::bigint
          END AS multiplier_numerator
        FROM "blackjack_games" bj
        WHERE bj."userId" = ${user.id}
          AND bj."currency" = ${PLATFORM_INTERNAL_CURRENCY}

        UNION ALL

        SELECT
          COALESCE(rb."payoutAtomic", 0)::bigint AS payout_atomic,
          rb."stakeAtomic"::bigint AS wager_atomic,
          CASE
            WHEN rb."stakeAtomic" > 0 THEN (COALESCE(rb."payoutAtomic", 0)::bigint * 100000000n) / rb."stakeAtomic"
            ELSE 0::bigint
          END AS multiplier_numerator
        FROM "roulette_bets" rb
        WHERE rb."userId" = ${user.id}
          AND rb."currency" = ${PLATFORM_INTERNAL_CURRENCY}

        UNION ALL

        SELECT
          COALESCE(co."payoutAtomic", 0)::bigint AS payout_atomic,
          co."priceAtomic"::bigint AS wager_atomic,
          CASE
            WHEN co."priceAtomic" > 0 THEN (COALESCE(co."payoutAtomic", 0)::bigint * 100000000n) / co."priceAtomic"
            ELSE 0::bigint
          END AS multiplier_numerator
        FROM "case_openings" co
        WHERE co."userId" = ${user.id}
          AND co."currency" = ${PLATFORM_INTERNAL_CURRENCY}

        UNION ALL

        SELECT
          COALESCE(bs."payoutAtomic", 0)::bigint AS payout_atomic,
          bs."paidAmountAtomic"::bigint AS wager_atomic,
          CASE
            WHEN bs."paidAmountAtomic" > 0 THEN (COALESCE(bs."payoutAtomic", 0)::bigint * 100000000n) / bs."paidAmountAtomic"
            ELSE 0::bigint
          END AS multiplier_numerator
        FROM "battle_slots" bs
        WHERE bs."userId" = ${user.id}
          AND bs."paidAmountAtomic" > 0
      ) x
      ORDER BY "payoutAtomic" DESC, "multiplierNumerator" DESC
      LIMIT 1
    `)
  ]);

  const minesWagered = minesAgg._sum.betAtomic ?? 0n;
  const blackjackWagered = blackjackAgg._sum.initialBetAtomic ?? 0n;
  const rouletteWagered = rouletteAgg._sum.stakeAtomic ?? 0n;
  const caseOpeningWagered = caseOpeningsAgg._sum.priceAtomic ?? 0n;
  const caseBattlesWagered = battleSlotsAgg._sum.paidAmountAtomic ?? 0n;
  const wageredTotal = minesWagered + blackjackWagered + rouletteWagered + caseOpeningWagered + caseBattlesWagered;

  const maxSingleWinAtomic = bestWin[0]?.payoutAtomic ?? 0n;
  const multiplierNumerator = bestWin[0]?.multiplierNumerator ?? 0n;
  const maxSingleMultiplier = Number(multiplierNumerator) / 1e8;

  return {
    user: {
      id: user.id,
      publicId: user.publicId ?? null,
      username,
      level,
      profileVisible: true
    },
    stats: {
      rewardsRedeemedAtomic: "0",
      rewardsRedeemedCoins: "0.00",
      wageredTotalAtomic: wageredTotal.toString(),
      wageredTotalCoins: toCoinsString(wageredTotal),
      wageredByMode: {
        caseBattlesAtomic: caseBattlesWagered.toString(),
        caseBattlesCoins: toCoinsString(caseBattlesWagered),
        caseOpeningAtomic: caseOpeningWagered.toString(),
        caseOpeningCoins: toCoinsString(caseOpeningWagered),
        minesAtomic: minesWagered.toString(),
        minesCoins: toCoinsString(minesWagered),
        blackjackAtomic: blackjackWagered.toString(),
        blackjackCoins: toCoinsString(blackjackWagered),
        rouletteAtomic: rouletteWagered.toString(),
        rouletteCoins: toCoinsString(rouletteWagered)
      },
      maxSingleWinAtomic: maxSingleWinAtomic.toString(),
      maxSingleWinCoins: toCoinsString(maxSingleWinAtomic),
      maxSingleMultiplier: maxSingleMultiplier.toFixed(4),
      currency: PLATFORM_VIRTUAL_COIN_SYMBOL
    }
  };
};

const getUserMinimalById = async (userId: string): Promise<{
  id: string;
  publicId: number | null;
  email: string;
  levelXpAtomic: bigint;
  profileVisible: boolean;
}> => {
  const row = await prisma.user
    .findUnique({
      where: { id: userId },
      select: {
        id: true,
        publicId: true,
        email: true,
        levelXpAtomic: true,
        profileVisible: true
      }
    })
    .catch(async (error) => {
      if (!isMissingPublicIdColumnError(error) && !isMissingLevelXpColumnError(error)) {
        throw error;
      }
      const fallback = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true
        }
      });
      if (!fallback) {
        return null;
      }
      return {
        id: fallback.id,
        publicId: null,
        email: fallback.email,
        levelXpAtomic: 0n,
        profileVisible: true
      };
    });

  if (!row) {
    throw new Error("USER_NOT_FOUND");
  }
  return row;
};

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  await ensureUserAvatarColumnsBestEffort();

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
          username: true,
          role: true,
          status: true,
          levelXpAtomic: true,
          createdAt: true
        }
      })
      .catch((error) => {
        if (isMissingLevelXpColumnError(error)) {
          return prisma.user.findUnique({
            where: {
              id: request.user.sub
            },
            select: {
              id: true,
              email: true,
              username: true,
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
    const avatarSources = await getUserAvatarSourcesBestEffort(request.user.sub);
    const effectiveAvatarUrl = resolveAvatarUrl(avatarSources.avatarUrl, avatarSources.providerAvatarUrl);
    const avatarSource = resolveAvatarSource(avatarSources.avatarUrl, avatarSources.providerAvatarUrl);

    const username = ("username" in user ? user.username : null) || user.email.split("@")[0] || `user#${publicId}`;

    return reply.send({
      id: user.id,
      publicId,
      email: user.email,
      username,
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
      },
      avatarUrl: effectiveAvatarUrl,
      customAvatarUrl: avatarSources.avatarUrl,
      providerAvatarUrl: avatarSources.providerAvatarUrl,
      avatarSource
    });
  });

  fastify.post("/me/password", { preHandler: requireAuth }, async (request, reply) => {
    const body = changePasswordSchema.parse(request.body);
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        passwordHash: string;
        status: "ACTIVE" | "SUSPENDED";
        twoFactorEnabled: boolean;
      }>
    >`
      SELECT
        id,
        "passwordHash",
        status,
        COALESCE("twoFactorEnabled", false) AS "twoFactorEnabled"
      FROM "users"
      WHERE id = ${request.user.sub}
      LIMIT 1
    `;
    const user = rows[0] ?? null;

    if (!user) {
      throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }

    if (user.status !== "ACTIVE") {
      throw new AppError("User is not active", 403, "USER_NOT_ACTIVE");
    }

    const currentPasswordValid = await verifyPasswordWithLegacySupport(user.passwordHash, body.currentPassword);
    if (!currentPasswordValid) {
      throw new AppError("Current password is invalid", 401, "INVALID_CURRENT_PASSWORD");
    }

    if (user.twoFactorEnabled) {
      const code = typeof body.twoFactorCode === "string" ? body.twoFactorCode.trim() : "";
      if (!code) {
        throw new AppError("Two-factor code is required", 401, "TWO_FACTOR_REQUIRED");
      }
      const valid2fa = await verifyTwoFactorCode(user.id, code);
      if (!valid2fa) {
        throw new AppError("Invalid two-factor code", 401, "INVALID_TWO_FACTOR_CODE");
      }
    }

    const nextHash = await argon2.hash(body.newPassword);
    await prisma.$executeRaw`
      UPDATE "users"
      SET "passwordHash" = ${nextHash},
          "updatedAt" = NOW()
      WHERE id = ${user.id}
    `;

    return reply.send({
      success: true,
      requiresTwoFactor: user.twoFactorEnabled
    });
  });

  fastify.get("/me/cashier-notifications", { preHandler: requireAuth }, async (request, reply) => {
    const query = notificationsQuerySchema.parse(request.query);
    const [deposits, withdrawals] = await Promise.all([
      prisma.deposit.findMany({
        where: {
          userId: request.user.sub,
          status: { in: [DepositStatus.PENDING, DepositStatus.CONFIRMING] }
        },
        orderBy: { createdAt: "desc" },
        take: query.limit
      }),
      prisma.withdrawal.findMany({
        where: {
          userId: request.user.sub,
          status: {
            in: [
              WithdrawalStatus.PENDING,
              WithdrawalStatus.IN_REVIEW,
              WithdrawalStatus.APPROVED,
              WithdrawalStatus.BROADCASTED,
              WithdrawalStatus.CONFIRMING
            ]
          }
        },
        orderBy: { createdAt: "desc" },
        take: query.limit
      })
    ]);

    const depositItems = deposits.map((deposit) => {
      const amountAsset = resolveDepositAssetAmount(deposit.metadata);
      const amountLabel = amountAsset !== null ? formatAssetAmount(amountAsset) : toCoinsString(deposit.amountAtomic);
      const assetLabel = (deposit.asset ?? "USDT").toUpperCase();
      return {
        id: `deposit:${deposit.id}`,
        type: "DEPOSIT" as const,
        color: "GREEN" as const,
        status: deposit.status,
        title: "Deposit is pending",
        description: `Your deposit of ${amountLabel} ${assetLabel} has been detected and is currently pending.`,
        createdAt: deposit.createdAt
      };
    });

    const withdrawalItems = withdrawals.map((withdrawal) => {
      const amountAsset = resolveWithdrawalAssetAmount(withdrawal.metadata);
      const amountLabel =
        amountAsset !== null ? formatAssetAmount(amountAsset) : toCoinsString(withdrawal.amountAtomic);
      const assetLabel = (withdrawal.asset ?? "USDT").toUpperCase();
      return {
        id: `withdrawal:${withdrawal.id}`,
        type: "WITHDRAWAL" as const,
        color: "GREEN" as const,
        status: withdrawal.status,
        title: "Withdrawal pending",
        description: `Your withdrawal of ${amountLabel} ${assetLabel} is being processed and will arrive shortly.`,
        createdAt: withdrawal.createdAt
      };
    });

    const items = [...depositItems, ...withdrawalItems]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, query.limit)
      .map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString()
      }));

    return reply.send({
      items,
      total: items.length
    });
  });

  fastify.get("/me/wins-ticker", { preHandler: requireAuth }, async (request, reply) => {
    const query = winsTickerQuerySchema.parse(request.query ?? {});
    const items = await getWinsTickerFeed(query.limit);
    return reply.send({ items });
  });

  fastify.patch("/me/avatar", { preHandler: requireAuth }, async (request, reply) => {
    const body = avatarUpdateSchema.parse(request.body);
    await ensureUserAvatarColumnsBestEffort();
    try {
      const updated = await updateUserAvatarBestEffort(request.user.sub, body.avatarUrl ?? null);
      const effectiveAvatarUrl = resolveAvatarUrl(updated.avatarUrl, updated.providerAvatarUrl);
      const avatarSource = resolveAvatarSource(updated.avatarUrl, updated.providerAvatarUrl);
      return reply.send({
        avatarUrl: effectiveAvatarUrl,
        customAvatarUrl: updated.avatarUrl,
        providerAvatarUrl: updated.providerAvatarUrl,
        avatarSource,
        updatedAt: updated.updatedAt
      });
    } catch (error) {
      if (error instanceof Error && error.message === "USER_NOT_FOUND") {
        return reply.code(404).send({
          code: "USER_NOT_FOUND",
          message: "User not found"
        });
      }
      throw error;
    }
  });

  fastify.get("/profile/summary", { preHandler: requireAuth }, async (request, reply) => {
    const summary = await getProfileSummary(request.user.sub);
    return reply.send(summary);
  });

  fastify.patch("/me/profile-visibility", { preHandler: requireAuth }, async (request, reply) => {
    const body = profileVisibilitySchema.parse(request.body);
    const updated = await setProfileVisibility(request.user.sub, body.profileVisible);
    return reply.send({
      profileVisible: updated.profileVisible,
      updatedAt: updated.updatedAt
    });
  });

  fastify.get(
    "/profiles/:publicId/summary",
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = z.object({ publicId: z.coerce.number().int().min(1) }).parse(request.params);
      try {
        const summary = await getPublicChatProfileSummary(params.publicId);
        return reply.send(summary);
      } catch (error) {
        if (error instanceof Error && error.message === "USER_NOT_FOUND") {
          return reply.code(404).send({
            code: "USER_NOT_FOUND",
            message: "User not found"
          });
        }
        throw error;
      }
    }
  );

  fastify.get(
    "/profiles/by-user/:userId/summary",
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = publicProfileByUserIdParamsSchema.parse(request.params);
      let user: {
        id: string;
        publicId: number | null;
        email: string;
      } | null = null;
      try {
        user = await prisma.user.findUnique({
          where: { id: params.userId },
          select: {
            id: true,
            publicId: true,
            email: true
          }
        });
      } catch (error) {
        if (!isMissingPublicIdColumnError(error)) {
          throw error;
        }
        const fallback = await prisma.user.findUnique({
          where: { id: params.userId },
          select: {
            id: true,
            email: true
          }
        });
        user = fallback
          ? {
              id: fallback.id,
              publicId: null,
              email: fallback.email
            }
          : null;
      }

      if (!user) {
        return reply.code(404).send({
          code: "USER_NOT_FOUND",
          message: "User not found"
        });
      }

      if (user.publicId !== null) {
        try {
          const summary = await getPublicChatProfileSummary(user.publicId);
          return reply.send(summary);
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "USER_NOT_FOUND") {
            throw error;
          }
        }
      }

      const minimal = await getUserMinimalById(user.id).catch((error) => {
        if (error instanceof Error && error.message === "USER_NOT_FOUND") {
          return null;
        }
        throw error;
      });
      if (!minimal) {
        return reply.code(404).send({
          code: "USER_NOT_FOUND",
          message: "User not found"
        });
      }

      return reply.send({
        user: {
          id: minimal.id,
          publicId: minimal.publicId,
          username: minimal.email.split("@")[0] || `user#${minimal.publicId ?? "?"}`,
          level: getLevelFromXp(minimal.levelXpAtomic),
          profileVisible: minimal.profileVisible
        },
        stats: {
          rewardsRedeemedAtomic: "0",
          rewardsRedeemedCoins: "0.00",
          wageredTotalAtomic: "0",
          wageredTotalCoins: "0.00",
          wageredByMode: {
            caseBattlesAtomic: "0",
            caseBattlesCoins: "0.00",
            caseOpeningAtomic: "0",
            caseOpeningCoins: "0.00",
            minesAtomic: "0",
            minesCoins: "0.00",
            blackjackAtomic: "0",
            blackjackCoins: "0.00",
            rouletteAtomic: "0",
            rouletteCoins: "0.00"
          },
          maxSingleWinAtomic: "0",
          maxSingleWinCoins: "0.00",
          maxSingleMultiplier: "0.0000",
          currency: PLATFORM_VIRTUAL_COIN_SYMBOL
        }
      });
    }
  );

  fastify.get("/public-profile/:publicId", { preHandler: requireAuth }, async (request, reply) => {
    const params = publicProfileParamsSchema.parse(request.params);

    const user = await prisma.user.findUnique({
      where: { publicId: params.publicId },
      select: {
        id: true,
        publicId: true,
        email: true,
        role: true,
        status: true,
        profileVisible: true,
        levelXpAtomic: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user) {
      return reply.code(404).send({ message: "User not found" });
    }

    if (!user.profileVisible) {
      return reply.code(403).send({
        code: "PROFILE_PRIVATE",
        message: "This profile is private"
      });
    }

    const [wallet, minesAgg, blackjackAgg, rouletteAgg, casesAgg, battlesAgg] = await Promise.all([
      prisma.wallet.findUnique({
        where: {
          userId_currency: {
            userId: user.id,
            currency: PLATFORM_INTERNAL_CURRENCY
          }
        },
        select: {
          id: true,
          balanceAtomic: true,
          lockedAtomic: true,
          updatedAt: true
        }
      }),
      prisma.minesGame.aggregate({
        where: { userId: user.id, currency: PLATFORM_INTERNAL_CURRENCY },
        _sum: { betAtomic: true, payoutAtomic: true },
        _max: { payoutAtomic: true, currentMultiplier: true }
      }),
      prisma.blackjackGame.aggregate({
        where: { userId: user.id, currency: PLATFORM_INTERNAL_CURRENCY },
        _sum: { initialBetAtomic: true, payoutAtomic: true },
        _max: { payoutAtomic: true }
      }),
      prisma.rouletteBet.aggregate({
        where: { userId: user.id, currency: PLATFORM_INTERNAL_CURRENCY },
        _sum: { stakeAtomic: true, payoutAtomic: true },
        _max: { payoutAtomic: true }
      }),
      prisma.caseOpening.aggregate({
        where: { userId: user.id, currency: PLATFORM_INTERNAL_CURRENCY },
        _sum: { priceAtomic: true, payoutAtomic: true },
        _max: { payoutAtomic: true }
      }),
      prisma.battleSlot.aggregate({
        where: { userId: user.id, paidAmountAtomic: { gt: 0n } },
        _sum: { paidAmountAtomic: true, payoutAtomic: true },
        _max: { payoutAtomic: true }
      })
    ]);

    const maxPayoutCandidates = [
      minesAgg._max.payoutAtomic ?? 0n,
      blackjackAgg._max.payoutAtomic ?? 0n,
      rouletteAgg._max.payoutAtomic ?? 0n,
      casesAgg._max.payoutAtomic ?? 0n,
      battlesAgg._max.payoutAtomic ?? 0n
    ];
    const maxSingleWinAtomic = maxPayoutCandidates.reduce((acc, value) => (value > acc ? value : acc), 0n);

    const maxMultiplierFromMinesDecimal = minesAgg._max.currentMultiplier;
    const maxMultiplierRaw =
      maxMultiplierFromMinesDecimal !== null && maxMultiplierFromMinesDecimal !== undefined
        ? Number(maxMultiplierFromMinesDecimal.toString())
        : 0;
    const maxMultiplier = Number.isFinite(maxMultiplierRaw) ? maxMultiplierRaw : 0;

    const level = getLevelFromXp(user.levelXpAtomic);
    const balanceAtomic = wallet?.balanceAtomic ?? 0n;
    const lockedAtomic = wallet?.lockedAtomic ?? 0n;
    const availableAtomic = balanceAtomic - lockedAtomic;

    return reply.send({
      user: {
        id: user.id,
        publicId: user.publicId,
        username: user.email.split("@")[0] || `user#${user.publicId}`,
        role: user.role,
        status: user.status,
        profileVisible: user.profileVisible,
        level,
        levelXpAtomic: user.levelXpAtomic.toString(),
        levelXp: toCoinsString(user.levelXpAtomic, 0),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      wallet: {
        walletId: wallet?.id ?? null,
        balanceAtomic: balanceAtomic.toString(),
        balanceCoins: toCoinsString(balanceAtomic),
        lockedAtomic: lockedAtomic.toString(),
        lockedCoins: toCoinsString(lockedAtomic),
        availableAtomic: availableAtomic.toString(),
        availableCoins: toCoinsString(availableAtomic),
        currency: PLATFORM_VIRTUAL_COIN_SYMBOL,
        updatedAt: wallet?.updatedAt ?? null
      },
      stats: {
        rewardsRedeemedAtomic: "0",
        rewardsRedeemedCoins: "0.00",
        totalWageredByMode: {
          minesAtomic: (minesAgg._sum.betAtomic ?? 0n).toString(),
          minesCoins: toCoinsString(minesAgg._sum.betAtomic ?? 0n),
          blackjackAtomic: (blackjackAgg._sum.initialBetAtomic ?? 0n).toString(),
          blackjackCoins: toCoinsString(blackjackAgg._sum.initialBetAtomic ?? 0n),
          rouletteAtomic: (rouletteAgg._sum.stakeAtomic ?? 0n).toString(),
          rouletteCoins: toCoinsString(rouletteAgg._sum.stakeAtomic ?? 0n),
          caseOpeningAtomic: (casesAgg._sum.priceAtomic ?? 0n).toString(),
          caseOpeningCoins: toCoinsString(casesAgg._sum.priceAtomic ?? 0n),
          caseBattlesAtomic: (battlesAgg._sum.paidAmountAtomic ?? 0n).toString(),
          caseBattlesCoins: toCoinsString(battlesAgg._sum.paidAmountAtomic ?? 0n)
        },
        totalPayoutByMode: {
          minesAtomic: (minesAgg._sum.payoutAtomic ?? 0n).toString(),
          minesCoins: toCoinsString(minesAgg._sum.payoutAtomic ?? 0n),
          blackjackAtomic: (blackjackAgg._sum.payoutAtomic ?? 0n).toString(),
          blackjackCoins: toCoinsString(blackjackAgg._sum.payoutAtomic ?? 0n),
          rouletteAtomic: (rouletteAgg._sum.payoutAtomic ?? 0n).toString(),
          rouletteCoins: toCoinsString(rouletteAgg._sum.payoutAtomic ?? 0n),
          caseOpeningAtomic: (casesAgg._sum.payoutAtomic ?? 0n).toString(),
          caseOpeningCoins: toCoinsString(casesAgg._sum.payoutAtomic ?? 0n),
          caseBattlesAtomic: (battlesAgg._sum.payoutAtomic ?? 0n).toString(),
          caseBattlesCoins: toCoinsString(battlesAgg._sum.payoutAtomic ?? 0n)
        },
        maxSingleWinAtomic: maxSingleWinAtomic.toString(),
        maxSingleWinCoins: toCoinsString(maxSingleWinAtomic),
        maxMultiplier
      }
    });
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

  fastify.put("/me/trade-url", { preHandler: requireAuth }, async (request, reply) => {
    const body = tradeUrlSchema.parse(request.body);
    await ensureProfileControlColumnsBestEffort();
    const normalized = normalizeSteamTradeUrl(body.tradeUrl ?? "");
    await prisma.$executeRaw`
      UPDATE "users"
      SET "steamTradeUrl" = ${normalized || null},
          "updatedAt" = NOW()
      WHERE id = ${request.user.sub}
    `;
    return reply.send({
      tradeUrl: normalized || null
    });
  });

  fastify.get("/me/security-settings", { preHandler: requireAuth }, async (request, reply) => {
    await ensureProfileControlColumnsBestEffort();
    const row = await prisma.$queryRaw<
      Array<{
        username: string | null;
        tradeUrl: string | null;
        usernameChangedAt: Date | null;
        selfExcludeUntil: Date | null;
      }>
    >`
      SELECT
        username,
        "steamTradeUrl" AS "tradeUrl",
        "usernameUpdatedAt" AS "usernameChangedAt",
        "selfExcludedUntil" AS "selfExcludeUntil"
      FROM "users"
      WHERE id = ${request.user.sub}
      LIMIT 1
    `;
    const current = row[0] ?? null;
    if (!current) {
      throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }
    const now = Date.now();
    const changedAt = current.usernameChangedAt?.getTime() ?? 0;
    const nextChangeAt = changedAt ? new Date(changedAt + USERNAME_CHANGE_COOLDOWN_MS) : null;
    const canChangeUsername = !nextChangeAt || nextChangeAt.getTime() <= now;
    return reply.send({
      username: current.username ?? null,
      tradeUrl: current.tradeUrl ?? null,
      usernameChangedAt: current.usernameChangedAt ? current.usernameChangedAt.toISOString() : null,
      usernameNextChangeAt: nextChangeAt ? nextChangeAt.toISOString() : null,
      canChangeUsername,
      selfExcludeUntil: current.selfExcludeUntil ? current.selfExcludeUntil.toISOString() : null
    });
  });

  fastify.put("/me/username", { preHandler: requireAuth }, async (request, reply) => {
    const body = updateUsernameSchema.parse(request.body);
    await ensureProfileControlColumnsBestEffort();
    const normalized = normalizeUsername(body.username);
    try {
      const existing = await prisma.user.findUnique({
        where: { username: normalized },
        select: { id: true }
      });
      if (existing && existing.id !== request.user.sub) {
        return reply.code(409).send({ code: "USERNAME_TAKEN", message: "This username is already taken" });
      }
    } catch (error) {
      if (!isMissingUsernameColumnError(error)) {
        throw error;
      }
    }
    const rows = await prisma.$queryRaw<Array<{ usernameChangedAt: Date | null; username: string | null }>>`
      SELECT "usernameUpdatedAt" AS "usernameChangedAt", username
      FROM "users"
      WHERE id = ${request.user.sub}
      LIMIT 1
    `;
    const current = rows[0] ?? null;
    if (!current) {
      throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }
    const now = new Date();
    const sameUsername = normalizeUsername(current.username ?? "") === normalized;
    const changedAt = current.usernameChangedAt?.getTime() ?? 0;
    const nextChangeAtMs = changedAt > 0 ? changedAt + USERNAME_CHANGE_COOLDOWN_MS : 0;
    if (!sameUsername && nextChangeAtMs > now.getTime()) {
      return reply.code(429).send({
        code: "USERNAME_COOLDOWN_ACTIVE",
        message: "You can only change your username once every 24 hours.",
        nextChangeAt: new Date(nextChangeAtMs).toISOString()
      });
    }
    const updated = await prisma.user.update({
      where: { id: request.user.sub },
      data: {
        username: normalized,
        ...(sameUsername ? {} : { usernameUpdatedAt: now })
      },
      select: { id: true, username: true, usernameUpdatedAt: true }
    });
    return reply.send({
      id: updated.id,
      username: updated.username,
      usernameChangedAt: updated.usernameUpdatedAt ? updated.usernameUpdatedAt.toISOString() : null,
      nextChangeAt: updated.usernameUpdatedAt
        ? new Date(updated.usernameUpdatedAt.getTime() + USERNAME_CHANGE_COOLDOWN_MS).toISOString()
        : null
    });
  });

  fastify.post("/me/self-exclusion", { preHandler: requireAuth }, async (request, reply) => {
    const body = setSelfExclusionSchema.parse(request.body);
    const confirmation = body.confirmationText.trim().toLowerCase();
    if (confirmation !== "confirm") {
      throw new AppError("You must type CONFIRM to continue", 400, "SELF_EXCLUSION_CONFIRMATION_INVALID");
    }
    await ensureProfileControlColumnsBestEffort();
    const now = new Date();
    const until = new Date(now.getTime() + body.durationDays * 24 * 60 * 60 * 1000);
    try {
      await prisma.$executeRaw`
        UPDATE "users"
        SET "selfExcludedUntil" = ${until},
            "selfExclusionReason" = ${body.confirmationText},
            "selfExclusionNoWager" = ${body.noWager},
            "selfExclusionNoWithdraw" = ${body.noWithdraw},
            "selfExclusionNoTip" = ${body.noTip},
            "updatedAt" = NOW()
        WHERE id = ${request.user.sub}
      `;
    } catch (error) {
      if (!isMissingSelfExclusionColumnError(error)) {
        throw error;
      }
      throw new AppError("Self-exclusion is not available yet in this environment", 503, "SELF_EXCLUSION_UNAVAILABLE");
    }
    return reply.send({
      success: true,
      until: until.toISOString(),
      noWager: body.noWager,
      noWithdraw: body.noWithdraw,
      noTip: body.noTip
    });
  });
};
