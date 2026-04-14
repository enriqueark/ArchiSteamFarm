import { Prisma, UserRole } from "@prisma/client";

import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";

type RestrictionTarget = "TIP" | "WITHDRAW" | "WAGER";

const RESTRICTION_MESSAGES: Record<RestrictionTarget, string> = {
  TIP: "Tipping is not available while your self-exclusion is active",
  WITHDRAW: "Withdrawals are not available while your self-exclusion is active",
  WAGER: "Betting is not available while your self-exclusion is active"
};

const RESTRICTION_CODES: Record<RestrictionTarget, string> = {
  TIP: "SELF_EXCLUDED_TIP_FORBIDDEN",
  WITHDRAW: "SELF_EXCLUDED_WITHDRAW_FORBIDDEN",
  WAGER: "SELF_EXCLUDED_WAGER_FORBIDDEN"
};

const SELF_EXCLUSION_FLAG_BY_TARGET: Record<RestrictionTarget, string> = {
  TIP: "selfExclusionNoTip",
  WITHDRAW: "selfExclusionNoWithdraw",
  WAGER: "selfExclusionNoWager"
};

const toDateSafe = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
};

const parseBool = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
};

const parseUserRole = (value: unknown): UserRole => {
  if (value === "ADMIN" || value === "SUPPORT" || value === "PLAYER") {
    return value;
  }
  return UserRole.PLAYER;
};

const isMissingSelfExclusionColumnError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
    return true;
  }
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("selfexcludeduntil") ||
    message.includes("selfexcludeuntil") ||
    message.includes("selfexclusionreason") ||
    message.includes("selfexclusionnote") ||
    message.includes("selfexclusionnowager") ||
    message.includes("selfexclusionnowithdraw") ||
    message.includes("selfexclusionnotip")
  );
};

const resolveFlags = (raw: {
  role: unknown;
  selfExcludeUntil: unknown;
  selfExclusionNoWager?: unknown;
  selfExclusionNoWithdraw?: unknown;
  selfExclusionNoTip?: unknown;
}) => {
  const role = parseUserRole(raw.role);
  const selfExcludeUntil = toDateSafe(raw.selfExcludeUntil);
  const now = Date.now();
  const isActive = Boolean(selfExcludeUntil && selfExcludeUntil.getTime() > now);
  return {
    role,
    selfExcludeUntil,
    isActive,
    noWager: parseBool(raw.selfExclusionNoWager, true),
    noWithdraw: parseBool(raw.selfExclusionNoWithdraw, true),
    noTip: parseBool(raw.selfExclusionNoTip, true)
  };
};

const clearExpiredSelfExclusion = async (userId: string): Promise<void> => {
  try {
    await prisma.$executeRaw`
      UPDATE "users"
      SET "selfExcludedUntil" = NULL,
          "updatedAt" = NOW()
      WHERE id = ${userId}
        AND "selfExcludedUntil" IS NOT NULL
        AND "selfExcludedUntil" <= NOW()
    `;
  } catch (error) {
    if (!isMissingSelfExclusionColumnError(error)) {
      throw error;
    }
  }

  await prisma.$executeRaw`
    UPDATE "users"
    SET "selfExcludeUntil" = NULL,
        "updatedAt" = NOW()
    WHERE id = ${userId}
      AND "selfExcludeUntil" IS NOT NULL
      AND "selfExcludeUntil" <= NOW()
  `;
};

const queryFlagsRaw = async (userId: string) =>
  prisma.$queryRaw<
    Array<{
      role: unknown;
      selfExcludeUntil: unknown;
      selfExclusionNoWager?: unknown;
      selfExclusionNoWithdraw?: unknown;
      selfExclusionNoTip?: unknown;
    }>
  >`
    SELECT
      role,
      COALESCE("selfExcludedUntil", "selfExcludeUntil") AS "selfExcludeUntil",
      "selfExclusionNoWager" AS "selfExclusionNoWager",
      "selfExclusionNoWithdraw" AS "selfExclusionNoWithdraw",
      "selfExclusionNoTip" AS "selfExclusionNoTip"
    FROM "users"
    WHERE id = ${userId}
    LIMIT 1
  `;

const queryFlagsRawCurrentNoFlags = async (userId: string) =>
  prisma.$queryRaw<
    Array<{
      role: unknown;
      selfExcludeUntil: unknown;
    }>
  >`
    SELECT
      role,
      "selfExcludedUntil" AS "selfExcludeUntil"
    FROM "users"
    WHERE id = ${userId}
    LIMIT 1
  `;

const queryFlagsLegacyOld = async (userId: string) =>
  prisma.$queryRaw<
    Array<{
      role: unknown;
      selfExcludeUntil: unknown;
    }>
  >`
    SELECT
      role,
      "selfExcludeUntil" AS "selfExcludeUntil"
    FROM "users"
    WHERE id = ${userId}
    LIMIT 1
  `;

const queryFlagsRoleOnly = async (userId: string) =>
  prisma.$queryRaw<
    Array<{
      role: unknown;
    }>
  >`
    SELECT role
    FROM "users"
    WHERE id = ${userId}
    LIMIT 1
  `;

export const getSelfExclusionState = async (userId: string): Promise<{
  active: boolean;
  until: Date | null;
  noWager: boolean;
  noWithdraw: boolean;
  noTip: boolean;
  role: UserRole;
}> => {
  try {
    const rows = await queryFlagsRaw(userId);
    const row = rows[0];
    if (!row) {
      throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }
    const flags = resolveFlags(row);
    if (!flags.isActive && flags.selfExcludeUntil) {
      await clearExpiredSelfExclusion(userId);
      return {
        active: false,
        until: null,
        noWager: true,
        noWithdraw: true,
        noTip: true,
        role: flags.role
      };
    }
    return {
      active: flags.isActive,
      until: flags.selfExcludeUntil,
      noWager: flags.noWager,
      noWithdraw: flags.noWithdraw,
      noTip: flags.noTip,
      role: flags.role
    };
  } catch (error) {
    if (!isMissingSelfExclusionColumnError(error)) {
      throw error;
    }
    try {
      const rows = await queryFlagsRawCurrentNoFlags(userId);
      const row = rows[0];
      if (!row) {
        throw new AppError("User not found", 404, "USER_NOT_FOUND");
      }
      const flags = resolveFlags(row);
      if (!flags.isActive && flags.selfExcludeUntil) {
        await clearExpiredSelfExclusion(userId);
        return {
          active: false,
          until: null,
          noWager: true,
          noWithdraw: true,
          noTip: true,
          role: flags.role
        };
      }
      return {
        active: flags.isActive,
        until: flags.selfExcludeUntil,
        noWager: flags.noWager,
        noWithdraw: flags.noWithdraw,
        noTip: flags.noTip,
        role: flags.role
      };
    } catch (legacyError) {
      if (!isMissingSelfExclusionColumnError(legacyError)) {
        throw legacyError;
      }
      try {
        const rows = await queryFlagsLegacyOld(userId);
        const row = rows[0];
        if (!row) {
          throw new AppError("User not found", 404, "USER_NOT_FOUND");
        }
        const flags = resolveFlags(row);
        if (!flags.isActive && flags.selfExcludeUntil) {
          await clearExpiredSelfExclusion(userId);
          return {
            active: false,
            until: null,
            noWager: true,
            noWithdraw: true,
            noTip: true,
            role: flags.role
          };
        }
        return {
          active: flags.isActive,
          until: flags.selfExcludeUntil,
          noWager: flags.noWager,
          noWithdraw: flags.noWithdraw,
          noTip: flags.noTip,
          role: flags.role
        };
      } catch (legacyOldError) {
        if (!isMissingSelfExclusionColumnError(legacyOldError)) {
          throw legacyOldError;
        }
        const rows = await queryFlagsRoleOnly(userId);
        const row = rows[0];
        if (!row) {
          throw new AppError("User not found", 404, "USER_NOT_FOUND");
        }
        return {
          active: false,
          until: null,
          noWager: true,
          noWithdraw: true,
          noTip: true,
          role: parseUserRole(row.role)
        };
      }
    }
  }
};

export const ensureUserAllowedFor = async (
  userId: string,
  target: RestrictionTarget,
  roleOverride?: UserRole
): Promise<void> => {
  const state = await getSelfExclusionState(userId);
  void roleOverride;
  void state.role;
  if (!state.active) {
    return;
  }
  const flagKey = SELF_EXCLUSION_FLAG_BY_TARGET[target];
  const blocked = (state as Record<string, unknown>)[flagKey] === true;
  if (!blocked) {
    return;
  }
  throw new AppError(RESTRICTION_MESSAGES[target], 403, RESTRICTION_CODES[target], {
    selfExcludeUntil: state.until?.toISOString() ?? null
  });
};

