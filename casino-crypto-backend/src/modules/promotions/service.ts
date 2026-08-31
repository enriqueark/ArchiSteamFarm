import { Currency, LedgerDirection, LedgerReason, Prisma } from "@prisma/client";

import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";
const COIN_DECIMALS = 100000000n;
const PLATFORM_INTERNAL_CURRENCY: Currency = Currency.USDT;
const PLATFORM_VIRTUAL_COIN_SYMBOL = "COINS";
const DEPOSIT_BONUS_BPS = 500n; // 5%
const DEPOSIT_BONUS_WINDOW_MS = 24 * 60 * 60 * 1000;
const PROMO_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
const AFFILIATE_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{2,19}$/;

const toCoinsString = (atomic: bigint, decimals = 2): string => {
  const sign = atomic < 0n ? "-" : "";
  const abs = atomic < 0n ? -atomic : atomic;
  const whole = abs / COIN_DECIMALS;
  const fractionRaw = (abs % COIN_DECIMALS).toString().padStart(8, "0");
  const fraction = decimals > 0 ? `.${fractionRaw.slice(0, decimals)}` : "";
  return `${sign}${whole.toString()}${fraction}`;
};

const normalizePromoCode = (value: string): string => value.trim().toUpperCase();
const normalizeAffiliateCode = (value: string): string => value.trim().toUpperCase();

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const isMissingPromotionsSchemaError = (error: unknown): boolean => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  ) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("promo_code") ||
    message.includes("promocodes") ||
    message.includes("withdrawwagerremainingatomic") ||
    message.includes("affiliate_deposit_bonus_activation") ||
    message.includes("affiliate_deposit_bonus_credit")
  );
};

const getCoinWalletLocked = async (tx: Prisma.TransactionClient, userId: string) => {
  const rows = await tx.$queryRaw<Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>>`
    SELECT id, "balanceAtomic", "lockedAtomic"
    FROM "wallets"
    WHERE "userId" = ${userId}
      AND "currency" = ${PLATFORM_INTERNAL_CURRENCY}
    FOR UPDATE
  `;
  const wallet = rows[0];
  if (!wallet) {
    throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
  }
  return wallet;
};

export const consumeWithdrawWagerRequirementInTx = async (
  tx: Prisma.TransactionClient,
  userId: string,
  wagerAtomic: bigint
): Promise<bigint> => {
  if (wagerAtomic <= 0n) {
    return 0n;
  }

  const rows = await tx.$queryRaw<Array<{ withdrawWagerRemainingAtomic: bigint }>>`
    UPDATE "users"
    SET "withdrawWagerRemainingAtomic" = GREATEST(0, COALESCE("withdrawWagerRemainingAtomic", 0) - ${wagerAtomic}),
        "updatedAt" = NOW()
    WHERE id = ${userId}
    RETURNING "withdrawWagerRemainingAtomic"
  `;

  if (!rows[0]) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  return rows[0].withdrawWagerRemainingAtomic;
};

const addWithdrawWagerRequirementInTx = async (
  tx: Prisma.TransactionClient,
  userId: string,
  amountAtomic: bigint
): Promise<bigint> => {
  if (amountAtomic <= 0n) {
    return 0n;
  }

  const rows = await tx.$queryRaw<Array<{ withdrawWagerRemainingAtomic: bigint }>>`
    UPDATE "users"
    SET "withdrawWagerRemainingAtomic" = COALESCE("withdrawWagerRemainingAtomic", 0) + ${amountAtomic},
        "updatedAt" = NOW()
    WHERE id = ${userId}
    RETURNING "withdrawWagerRemainingAtomic"
  `;

  if (!rows[0]) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  return rows[0].withdrawWagerRemainingAtomic;
};

export const addWithdrawWagerRequirementBestEffort = async (
  userId: string,
  amountAtomic: bigint
): Promise<void> => {
  if (amountAtomic <= 0n) {
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await addWithdrawWagerRequirementInTx(tx, userId, amountAtomic);
    });
  } catch (error) {
    if (isMissingPromotionsSchemaError(error)) {
      return;
    }
    throw error;
  }
};

export const getWithdrawWagerRemainingAtomic = async (userId: string): Promise<bigint> => {
  try {
    const rows = await prisma.$queryRaw<Array<{ withdrawWagerRemainingAtomic: bigint }>>`
      SELECT COALESCE("withdrawWagerRemainingAtomic", 0)::bigint AS "withdrawWagerRemainingAtomic"
      FROM "users"
      WHERE id = ${userId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }
    return row.withdrawWagerRemainingAtomic;
  } catch (error) {
    if (isMissingPromotionsSchemaError(error)) {
      return 0n;
    }
    throw error;
  }
};

export const setWithdrawWagerRemainingAtomicByAdmin = async (
  userId: string,
  remainingAtomic: bigint
): Promise<{ userId: string; remainingAtomic: bigint; remainingCoins: string }> => {
  if (remainingAtomic < 0n) {
    throw new AppError("Wager requirement cannot be negative", 400, "INVALID_WAGER_REQUIREMENT");
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; withdrawWagerRemainingAtomic: bigint }>>`
      UPDATE "users"
      SET "withdrawWagerRemainingAtomic" = ${remainingAtomic},
          "updatedAt" = NOW()
      WHERE id = ${userId}
      RETURNING id, "withdrawWagerRemainingAtomic"
    `;
    const row = rows[0];
    if (!row) {
      throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }
    return {
      userId: row.id,
      remainingAtomic: row.withdrawWagerRemainingAtomic,
      remainingCoins: toCoinsString(row.withdrawWagerRemainingAtomic)
    };
  } catch (error) {
    if (isMissingPromotionsSchemaError(error)) {
      throw new AppError("Promotions schema is not ready", 503, "PROMOTIONS_SCHEMA_NOT_READY");
    }
    throw error;
  }
};

export const createPromoCodeByAdmin = async (input: {
  actorUserId: string;
  code: string;
  usageLimit: number;
  rewardAtomic: bigint;
}) => {
  const code = normalizePromoCode(input.code);
  if (!PROMO_CODE_REGEX.test(code)) {
    throw new AppError(
      "Promo code must be 3-32 chars using A-Z, 0-9, - or _",
      400,
      "INVALID_PROMO_CODE"
    );
  }
  if (!Number.isInteger(input.usageLimit) || input.usageLimit <= 0) {
    throw new AppError("Usage limit must be a positive integer", 400, "INVALID_PROMO_USAGE_LIMIT");
  }
  if (input.rewardAtomic <= 0n) {
    throw new AppError("Promo reward must be greater than 0", 400, "INVALID_PROMO_REWARD");
  }

  try {
    const created = await prisma.promoCode.create({
      data: {
        code,
        usageLimit: input.usageLimit,
        rewardAtomic: input.rewardAtomic,
        usageCount: 0,
        isActive: true,
        createdByUserId: input.actorUserId
      }
    });

    return {
      id: created.id,
      code: created.code,
      rewardAtomic: created.rewardAtomic.toString(),
      rewardCoins: toCoinsString(created.rewardAtomic),
      usageLimit: created.usageLimit,
      usageCount: created.usageCount,
      remainingUses: Math.max(0, created.usageLimit - created.usageCount),
      isActive: created.isActive,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("Promo code already exists", 409, "PROMO_CODE_EXISTS");
    }
    if (isMissingPromotionsSchemaError(error)) {
      throw new AppError("Promotions schema is not ready", 503, "PROMOTIONS_SCHEMA_NOT_READY");
    }
    throw error;
  }
};

export const listPromoCodesByAdmin = async (query: {
  limit: number;
  q?: string;
  onlyActive?: boolean;
}) => {
  const limit = Math.max(1, Math.min(500, Math.trunc(query.limit)));
  const q = query.q?.trim();
  try {
    const rows = await prisma.promoCode.findMany({
      where: {
        ...(q
          ? {
              code: {
                contains: q.toUpperCase(),
                mode: "insensitive"
              }
            }
          : {}),
        ...(query.onlyActive ? { isActive: true } : {})
      },
      orderBy: [{ createdAt: "desc" }],
      take: limit
    });

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      rewardAtomic: row.rewardAtomic.toString(),
      rewardCoins: toCoinsString(row.rewardAtomic),
      usageLimit: row.usageLimit,
      usageCount: row.usageCount,
      remainingUses: Math.max(0, row.usageLimit - row.usageCount),
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  } catch (error) {
    if (isMissingPromotionsSchemaError(error)) {
      throw new AppError("Promotions schema is not ready", 503, "PROMOTIONS_SCHEMA_NOT_READY");
    }
    throw error;
  }
};

export const redeemPromoCode = async (input: { userId: string; code: string }) => {
  const code = normalizePromoCode(input.code);
  if (!PROMO_CODE_REGEX.test(code)) {
    throw new AppError("Promo code format is invalid", 400, "INVALID_PROMO_CODE");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const promoRows = await tx.$queryRaw<
        Array<{ id: string; code: string; rewardAtomic: bigint; usageLimit: number; usageCount: number; isActive: boolean }>
      >`
        SELECT id, code, "rewardAtomic", "usageLimit", "usageCount", "isActive"
        FROM "promo_codes"
        WHERE code = ${code}
        LIMIT 1
        FOR UPDATE
      `;
      const promo = promoRows[0];
      if (!promo || !promo.isActive) {
        throw new AppError("Promo code is invalid or disabled", 404, "PROMO_CODE_NOT_FOUND");
      }
      if (promo.usageCount >= promo.usageLimit) {
        throw new AppError("Promo code has no uses left", 409, "PROMO_CODE_EXHAUSTED");
      }

      const alreadyRedeemed = await tx.promoCodeRedemption.findUnique({
        where: {
          promoCodeId_userId: {
            promoCodeId: promo.id,
            userId: input.userId
          }
        },
        select: {
          id: true
        }
      });
      if (alreadyRedeemed) {
        throw new AppError("You have already redeemed this promo code", 409, "PROMO_CODE_ALREADY_REDEEMED");
      }

      const wallet = await getCoinWalletLocked(tx, input.userId);
      const promoUpdate = await tx.promoCode.updateMany({
        where: {
          id: promo.id,
          isActive: true,
          usageCount: {
            lt: promo.usageLimit
          }
        },
        data: {
          usageCount: {
            increment: 1
          }
        }
      });
      if (promoUpdate.count === 0) {
        throw new AppError("Promo code has no uses left", 409, "PROMO_CODE_EXHAUSTED");
      }

      const redemption = await tx.promoCodeRedemption.create({
        data: {
          promoCodeId: promo.id,
          userId: input.userId,
          rewardAtomic: promo.rewardAtomic
        }
      });

      const walletRows = await tx.$queryRaw<Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>>`
        UPDATE "wallets"
        SET "balanceAtomic" = "balanceAtomic" + ${promo.rewardAtomic},
            "updatedAt" = NOW()
        WHERE id = ${wallet.id}
        RETURNING id, "balanceAtomic", "lockedAtomic"
      `;
      const walletUpdated = walletRows[0];
      if (!walletUpdated) {
        throw new AppError("Wallet update failed", 500, "WALLET_UPDATE_FAILED");
      }

      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          direction: LedgerDirection.CREDIT,
          reason: LedgerReason.BONUS,
          amountAtomic: promo.rewardAtomic,
          balanceBeforeAtomic: wallet.balanceAtomic,
          balanceAfterAtomic: walletUpdated.balanceAtomic,
          idempotencyKey: `promo:redeem:${redemption.id}`,
          referenceId: redemption.id,
          metadata: {
            source: "PROMO_CODE_REDEEM",
            promoCode: promo.code
          } as Prisma.InputJsonValue
        }
      });

      const withdrawWagerRemainingAtomic = await addWithdrawWagerRequirementInTx(
        tx,
        input.userId,
        promo.rewardAtomic
      );

      return {
        redemptionId: redemption.id,
        promoCode: promo.code,
        rewardAtomic: promo.rewardAtomic.toString(),
        rewardCoins: toCoinsString(promo.rewardAtomic),
        usageLeft: Math.max(0, promo.usageLimit - (promo.usageCount + 1)),
        currency: PLATFORM_VIRTUAL_COIN_SYMBOL,
        wallet: {
          walletId: walletUpdated.id,
          balanceAtomic: walletUpdated.balanceAtomic.toString(),
          balanceCoins: toCoinsString(walletUpdated.balanceAtomic),
          lockedAtomic: walletUpdated.lockedAtomic.toString(),
          lockedCoins: toCoinsString(walletUpdated.lockedAtomic)
        },
        withdrawWagerRemainingAtomic: withdrawWagerRemainingAtomic.toString(),
        withdrawWagerRemainingCoins: toCoinsString(withdrawWagerRemainingAtomic)
      };
    });
  } catch (error) {
    if (isMissingPromotionsSchemaError(error)) {
      throw new AppError("Promotions schema is not ready", 503, "PROMOTIONS_SCHEMA_NOT_READY");
    }
    throw error;
  }
};

export const applyDepositBonusCode = async (input: { userId: string; code: string }) => {
  const code = normalizeAffiliateCode(input.code);
  if (!AFFILIATE_CODE_REGEX.test(code)) {
    throw new AppError("Affiliate code format is invalid", 400, "INVALID_AFFILIATE_CODE");
  }

  try {
    const affiliateCode = await prisma.affiliateCode.findUnique({
      where: { code },
      select: {
        id: true,
        code: true,
        userId: true,
        user: {
          select: {
            username: true,
            email: true,
            publicId: true
          }
        }
      }
    });

    if (!affiliateCode) {
      throw new AppError("Affiliate code not found", 404, "AFFILIATE_CODE_NOT_FOUND");
    }
    if (affiliateCode.userId === input.userId) {
      throw new AppError("You cannot apply your own affiliate code", 409, "SELF_AFFILIATE_BONUS_FORBIDDEN");
    }

    const now = new Date();
    const current = await prisma.affiliateDepositBonusActivation.findUnique({
      where: { userId: input.userId },
      select: {
        id: true,
        expiresAt: true
      }
    });
    if (current?.expiresAt && current.expiresAt.getTime() > now.getTime()) {
      throw new AppError(
        `A deposit bonus code is already active until ${current.expiresAt.toISOString()}`,
        409,
        "DEPOSIT_BONUS_ALREADY_ACTIVE"
      );
    }

    const expiresAt = new Date(now.getTime() + DEPOSIT_BONUS_WINDOW_MS);
    const activation = await prisma.affiliateDepositBonusActivation.upsert({
      where: {
        userId: input.userId
      },
      update: {
        affiliateCodeId: affiliateCode.id,
        referrerUserId: affiliateCode.userId,
        code: affiliateCode.code,
        bonusBps: Number(DEPOSIT_BONUS_BPS),
        activatedAt: now,
        expiresAt
      },
      create: {
        userId: input.userId,
        affiliateCodeId: affiliateCode.id,
        referrerUserId: affiliateCode.userId,
        code: affiliateCode.code,
        bonusBps: Number(DEPOSIT_BONUS_BPS),
        activatedAt: now,
        expiresAt
      }
    });

    const referrerLabelRaw = affiliateCode.user.username?.trim() || affiliateCode.user.email.split("@")[0]?.trim() || "player";

    return {
      code: activation.code,
      bonusPercent: activation.bonusBps / 100,
      activatedAt: activation.activatedAt,
      expiresAt: activation.expiresAt,
      referrer: {
        publicId: affiliateCode.user.publicId,
        userLabel: referrerLabelRaw.slice(0, 24)
      }
    };
  } catch (error) {
    if (isMissingPromotionsSchemaError(error)) {
      throw new AppError("Promotions schema is not ready", 503, "PROMOTIONS_SCHEMA_NOT_READY");
    }
    throw error;
  }
};

export const getDepositBonusStatus = async (userId: string) => {
  try {
    const activation = await prisma.affiliateDepositBonusActivation.findUnique({
      where: { userId },
      select: {
        code: true,
        bonusBps: true,
        activatedAt: true,
        expiresAt: true,
        referrer: {
          select: {
            username: true,
            email: true,
            publicId: true
          }
        }
      }
    });

    if (!activation) {
      return { active: false } as const;
    }

    const now = Date.now();
    const active = activation.expiresAt.getTime() > now;
    const referrerLabelRaw = activation.referrer.username?.trim() || activation.referrer.email.split("@")[0]?.trim() || "player";

    return {
      active,
      code: activation.code,
      bonusPercent: activation.bonusBps / 100,
      activatedAt: activation.activatedAt,
      expiresAt: activation.expiresAt,
      referrer: {
        publicId: activation.referrer.publicId,
        userLabel: referrerLabelRaw.slice(0, 24)
      }
    };
  } catch (error) {
    if (isMissingPromotionsSchemaError(error)) {
      return { active: false } as const;
    }
    throw error;
  }
};

export const applyDepositBonusForDepositBestEffort = async (
  depositId: string,
  referredUserId: string,
  depositAmountAtomic: bigint
): Promise<void> => {
  if (depositAmountAtomic <= 0n) {
    return;
  }
  const bonusAtomic = (depositAmountAtomic * DEPOSIT_BONUS_BPS) / 10_000n;
  if (bonusAtomic <= 0n) {
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      const activation = await tx.affiliateDepositBonusActivation.findUnique({
        where: { userId: referredUserId },
        select: {
          id: true,
          code: true,
          bonusBps: true,
          referrerUserId: true,
          expiresAt: true
        }
      });

      if (!activation || activation.expiresAt.getTime() <= now.getTime()) {
        return;
      }

      const wallet = await getCoinWalletLocked(tx, referredUserId);
      await tx.affiliateDepositBonusCredit.create({
        data: {
          depositId,
          activationId: activation.id,
          referredUserId,
          bonusAtomic
        }
      });

      const walletRows = await tx.$queryRaw<Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>>`
        UPDATE "wallets"
        SET "balanceAtomic" = "balanceAtomic" + ${bonusAtomic},
            "updatedAt" = NOW()
        WHERE id = ${wallet.id}
        RETURNING id, "balanceAtomic", "lockedAtomic"
      `;
      const walletUpdated = walletRows[0];
      if (!walletUpdated) {
        throw new AppError("Wallet update failed", 500, "WALLET_UPDATE_FAILED");
      }

      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          direction: LedgerDirection.CREDIT,
          reason: LedgerReason.BONUS,
          amountAtomic: bonusAtomic,
          balanceBeforeAtomic: wallet.balanceAtomic,
          balanceAfterAtomic: walletUpdated.balanceAtomic,
          idempotencyKey: `affiliate:deposit-bonus:${depositId}`,
          referenceId: depositId,
          metadata: {
            source: "AFFILIATE_DEPOSIT_BONUS",
            activationCode: activation.code
          } as Prisma.InputJsonValue
        }
      });

      await tx.referral.updateMany({
        where: {
          referredUserId,
          referrerUserId: activation.referrerUserId
        },
        data: {
          bonusReceivedAtomic: {
            increment: bonusAtomic
          }
        }
      });

      await addWithdrawWagerRequirementInTx(tx, referredUserId, bonusAtomic);
    });
  } catch (error) {
    if (isUniqueViolation(error) || isMissingPromotionsSchemaError(error)) {
      return;
    }
    console.warn("promotions.deposit_bonus_credit_failed", {
      depositId,
      referredUserId,
      reason: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

export const ensurePromotionsSchemaReadyBestEffort = async (): Promise<void> => {
  try {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "withdrawWagerRemainingAtomic" BIGINT NOT NULL DEFAULT 0'
    );
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "promo_codes" (
        "id" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "rewardAtomic" BIGINT NOT NULL,
        "usageLimit" INTEGER NOT NULL,
        "usageCount" INTEGER NOT NULL DEFAULT 0,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdByUserId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "promo_codes_code_key" ON "promo_codes"("code")');
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "promo_code_redemptions" (
        "id" TEXT NOT NULL,
        "promoCodeId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "rewardAtomic" BIGINT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "promo_code_redemptions_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "promo_code_redemptions_promoCodeId_userId_key" ON "promo_code_redemptions"("promoCodeId","userId")'
    );
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "affiliate_deposit_bonus_activations" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "affiliateCodeId" TEXT NOT NULL,
        "referrerUserId" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "bonusBps" INTEGER NOT NULL DEFAULT 500,
        "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "affiliate_deposit_bonus_activations_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_deposit_bonus_activations_userId_key" ON "affiliate_deposit_bonus_activations"("userId")'
    );
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "affiliate_deposit_bonus_credits" (
        "id" TEXT NOT NULL,
        "depositId" TEXT NOT NULL,
        "activationId" TEXT NOT NULL,
        "referredUserId" TEXT NOT NULL,
        "bonusAtomic" BIGINT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "affiliate_deposit_bonus_credits_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_deposit_bonus_credits_depositId_key" ON "affiliate_deposit_bonus_credits"("depositId")'
    );
  } catch {
    // ignored
  }
};
