import { DepositStatus, LedgerDirection, LedgerReason, Prisma, WithdrawalStatus } from "@prisma/client";

import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";
import { getLevelFromXp } from "../progression/service";
import { PLATFORM_INTERNAL_CURRENCY } from "../wallets/service";

const AFFILIATE_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{2,19}$/;
const COMMISSION_BPS = 100n; // 1% of referred wager
const DEPOSIT_BONUS_BPS = 500n; // 5% bonus on deposit

const isKnownRequestError = (error: unknown, code: string): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

const isMissingAffiliateSchemaError = (error: unknown): boolean => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  ) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const msg = error.message.toLowerCase();
  return (
    msg.includes("affiliate_") ||
    msg.includes("referrals") ||
    msg.includes("profilevisible")
  );
};

const normalizeAffiliateCode = (value: string): string =>
  value.trim().toUpperCase();

const calculateBps = (baseAtomic: bigint, bps: bigint): bigint =>
  (baseAtomic * bps) / 10_000n;

const formatUserLabel = (email: string, publicId: number | null): string => {
  const local = email.split("@")[0]?.trim();
  if (local && local.length > 0) {
    return local.slice(0, 24);
  }
  if (publicId && Number.isFinite(publicId)) {
    return `user#${publicId}`;
  }
  return "player";
};

export const saveAffiliateCode = async (userId: string, rawCode: string) => {
  const code = normalizeAffiliateCode(rawCode);
  if (!AFFILIATE_CODE_REGEX.test(code)) {
    throw new AppError(
      "Affiliate code must be 3-20 chars using A-Z, 0-9, - or _",
      400,
      "INVALID_AFFILIATE_CODE"
    );
  }

  const taken = await prisma.affiliateCode.findUnique({
    where: { code },
    select: { userId: true }
  });
  if (taken && taken.userId !== userId) {
    throw new AppError("Affiliate code is already taken", 409, "AFFILIATE_CODE_TAKEN");
  }

  const saved = await prisma.affiliateCode.upsert({
    where: { userId },
    update: { code },
    create: { userId, code },
    select: { code: true, createdAt: true, updatedAt: true }
  });

  return {
    code: saved.code,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt
  };
};

export const applyAffiliateCode = async (userId: string, rawCode: string) => {
  const code = normalizeAffiliateCode(rawCode);
  if (!AFFILIATE_CODE_REGEX.test(code)) {
    throw new AppError(
      "Affiliate code format is invalid",
      400,
      "INVALID_AFFILIATE_CODE"
    );
  }

  const affiliateCode = await prisma.affiliateCode.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      userId: true,
      user: { select: { publicId: true, email: true } }
    }
  });
  if (!affiliateCode) {
    throw new AppError("Affiliate code not found", 404, "AFFILIATE_CODE_NOT_FOUND");
  }
  if (affiliateCode.userId === userId) {
    throw new AppError("You cannot apply your own affiliate code", 409, "SELF_REFERRAL_FORBIDDEN");
  }

  const existing = await prisma.referral.findUnique({
    where: { referredUserId: userId },
    select: { id: true }
  });
  if (existing) {
    throw new AppError("You have already applied an affiliate code", 409, "AFFILIATE_ALREADY_APPLIED");
  }

  const referral = await prisma.referral.create({
    data: {
      referrerUserId: affiliateCode.userId,
      referredUserId: userId,
      affiliateCodeId: affiliateCode.id
    },
    select: {
      id: true,
      createdAt: true
    }
  });

  return {
    referralId: referral.id,
    createdAt: referral.createdAt,
    code: affiliateCode.code,
    referrer: {
      publicId: affiliateCode.user.publicId,
      userLabel: formatUserLabel(affiliateCode.user.email, affiliateCode.user.publicId)
    }
  };
};

export const getAffiliateDashboard = async (userId: string) => {
  const [ownCode, referralApplied, myReferrals] = await Promise.all([
    prisma.affiliateCode.findUnique({
      where: { userId },
      select: { code: true, createdAt: true, updatedAt: true }
    }),
    prisma.referral.findUnique({
      where: { referredUserId: userId },
      select: {
        createdAt: true,
        bonusReceivedAtomic: true,
        affiliateCode: {
          select: {
            code: true
          }
        },
        referrer: {
          select: {
            publicId: true,
            email: true
          }
        }
      }
    }),
    prisma.referral.findMany({
      where: { referrerUserId: userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        totalWageredAtomic: true,
        totalCommissionAtomic: true,
        claimableCommissionAtomic: true,
        claimedCommissionAtomic: true,
        bonusReceivedAtomic: true,
        referred: {
          select: {
            id: true,
            publicId: true,
            email: true,
            createdAt: true
          }
        }
      }
    })
  ]);

  const stats = myReferrals.reduce(
    (acc, row) => {
      acc.totalWageredAtomic += row.totalWageredAtomic;
      acc.totalCommissionAtomic += row.totalCommissionAtomic;
      acc.claimableCommissionAtomic += row.claimableCommissionAtomic;
      acc.claimedCommissionAtomic += row.claimedCommissionAtomic;
      return acc;
    },
    {
      totalWageredAtomic: 0n,
      totalCommissionAtomic: 0n,
      claimableCommissionAtomic: 0n,
      claimedCommissionAtomic: 0n
    }
  );

  return {
    myCode: ownCode
      ? {
          code: ownCode.code,
          createdAt: ownCode.createdAt,
          updatedAt: ownCode.updatedAt
        }
      : null,
    appliedCode: referralApplied
      ? {
          code: referralApplied.affiliateCode.code,
          createdAt: referralApplied.createdAt,
          bonusReceivedAtomic: referralApplied.bonusReceivedAtomic.toString(),
          referrer: {
            publicId: referralApplied.referrer.publicId,
            userLabel: formatUserLabel(
              referralApplied.referrer.email,
              referralApplied.referrer.publicId
            )
          }
        }
      : null,
    stats: {
      referralCount: myReferrals.length,
      totalWageredAtomic: stats.totalWageredAtomic.toString(),
      totalCommissionAtomic: stats.totalCommissionAtomic.toString(),
      claimableCommissionAtomic: stats.claimableCommissionAtomic.toString(),
      claimedCommissionAtomic: stats.claimedCommissionAtomic.toString()
    },
    referrals: myReferrals.map((row) => ({
      referralId: row.id,
      createdAt: row.createdAt,
      user: {
        id: row.referred.id,
        publicId: row.referred.publicId,
        userLabel: formatUserLabel(row.referred.email, row.referred.publicId),
        createdAt: row.referred.createdAt
      },
      totalWageredAtomic: row.totalWageredAtomic.toString(),
      totalCommissionAtomic: row.totalCommissionAtomic.toString(),
      claimableCommissionAtomic: row.claimableCommissionAtomic.toString(),
      claimedCommissionAtomic: row.claimedCommissionAtomic.toString(),
      bonusReceivedAtomic: row.bonusReceivedAtomic.toString(),
      active: row.totalWageredAtomic > 0n
    }))
  };
};

export const claimAffiliateCommission = async (userId: string, idempotencyKey: string) =>
  prisma.$transaction(async (tx) => {
    const walletRows = await tx.$queryRaw<
      Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>
    >`
      SELECT id, "balanceAtomic", "lockedAtomic"
      FROM "wallets"
      WHERE "userId" = ${userId}
        AND "currency" = ${PLATFORM_INTERNAL_CURRENCY}
      FOR UPDATE
    `;
    const wallet = walletRows[0];
    if (!wallet) {
      throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
    }

    const existing = await tx.ledgerEntry.findUnique({
      where: {
        walletId_idempotencyKey: {
          walletId: wallet.id,
          idempotencyKey
        }
      },
      select: {
        amountAtomic: true,
        balanceAfterAtomic: true,
        createdAt: true
      }
    });
    if (existing) {
      return {
        claimedAtomic: existing.amountAtomic.toString(),
        balanceAtomic: existing.balanceAfterAtomic.toString(),
        claimedAt: existing.createdAt
      };
    }

    const referrals = await tx.$queryRaw<
      Array<{ id: string; claimableCommissionAtomic: bigint }>
    >`
      SELECT id, "claimableCommissionAtomic"
      FROM "referrals"
      WHERE "referrerUserId" = ${userId}
        AND "claimableCommissionAtomic" > 0
      FOR UPDATE
    `;

    const claimedAtomic = referrals.reduce(
      (sum, row) => sum + row.claimableCommissionAtomic,
      0n
    );
    if (claimedAtomic <= 0n) {
      throw new AppError("No claimable affiliate earnings", 409, "NO_CLAIMABLE_AFFILIATE_EARNINGS");
    }

    const walletUpdatedRows = await tx.$queryRaw<
      Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>
    >`
      UPDATE "wallets"
      SET "balanceAtomic" = "balanceAtomic" + ${claimedAtomic},
          "updatedAt" = NOW()
      WHERE id = ${wallet.id}
      RETURNING id, "balanceAtomic", "lockedAtomic"
    `;
    const walletUpdated = walletUpdatedRows[0];
    if (!walletUpdated) {
      throw new AppError("Wallet update failed", 500, "WALLET_UPDATE_FAILED");
    }

    await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        direction: LedgerDirection.CREDIT,
        reason: LedgerReason.BONUS,
        amountAtomic: claimedAtomic,
        balanceBeforeAtomic: wallet.balanceAtomic,
        balanceAfterAtomic: walletUpdated.balanceAtomic,
        idempotencyKey,
        referenceId: `affiliate:claim:${userId}`,
        metadata: {
          source: "AFFILIATE_CLAIM"
        } as Prisma.InputJsonValue
      }
    });

    await tx.$executeRaw`
      UPDATE "referrals"
      SET "claimedCommissionAtomic" = "claimedCommissionAtomic" + "claimableCommissionAtomic",
          "claimableCommissionAtomic" = 0,
          "updatedAt" = NOW()
      WHERE "referrerUserId" = ${userId}
        AND "claimableCommissionAtomic" > 0
    `;

    return {
      claimedAtomic: claimedAtomic.toString(),
      balanceAtomic: walletUpdated.balanceAtomic.toString(),
      claimedAt: new Date()
    };
  });

export const addAffiliateCommissionBestEffort = async (
  referredUserId: string,
  wagerAtomic: bigint,
  source: string,
  idempotencyKey: string
): Promise<void> => {
  if (wagerAtomic <= 0n) {
    return;
  }
  const commissionAtomic = calculateBps(wagerAtomic, COMMISSION_BPS);
  if (commissionAtomic <= 0n) {
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const referral = await tx.referral.findUnique({
        where: { referredUserId },
        select: {
          id: true,
          referrerUserId: true
        }
      });
      if (!referral) {
        return;
      }

      await tx.affiliateCommissionEvent.create({
        data: {
          referralId: referral.id,
          referrerUserId: referral.referrerUserId,
          referredUserId,
          source,
          wagerAtomic,
          commissionAtomic,
          idempotencyKey
        }
      });

      await tx.referral.update({
        where: { id: referral.id },
        data: {
          totalWageredAtomic: { increment: wagerAtomic },
          totalCommissionAtomic: { increment: commissionAtomic },
          claimableCommissionAtomic: { increment: commissionAtomic }
        }
      });
    });
  } catch (error) {
    if (isKnownRequestError(error, "P2002") || isMissingAffiliateSchemaError(error)) {
      return;
    }
    throw error;
  }
};

export const applyReferralDepositBonusBestEffort = async (
  depositId: string,
  referredUserId: string,
  depositAmountAtomic: bigint
): Promise<void> => {
  if (depositAmountAtomic <= 0n) {
    return;
  }
  const bonusAtomic = calculateBps(depositAmountAtomic, DEPOSIT_BONUS_BPS);
  if (bonusAtomic <= 0n) {
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const referral = await tx.referral.findUnique({
        where: { referredUserId },
        select: {
          id: true
        }
      });
      if (!referral) {
        return;
      }

      await tx.affiliateDepositBonus.create({
        data: {
          referralId: referral.id,
          referredUserId,
          depositId,
          bonusAtomic
        }
      });

      const walletRows = await tx.$queryRaw<
        Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>
      >`
        SELECT id, "balanceAtomic", "lockedAtomic"
        FROM "wallets"
        WHERE "userId" = ${referredUserId}
          AND "currency" = ${PLATFORM_INTERNAL_CURRENCY}
        FOR UPDATE
      `;
      const wallet = walletRows[0];
      if (!wallet) {
        throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
      }

      const walletUpdatedRows = await tx.$queryRaw<
        Array<{ id: string; balanceAtomic: bigint; lockedAtomic: bigint }>
      >`
        UPDATE "wallets"
        SET "balanceAtomic" = "balanceAtomic" + ${bonusAtomic},
            "updatedAt" = NOW()
        WHERE id = ${wallet.id}
        RETURNING id, "balanceAtomic", "lockedAtomic"
      `;
      const walletUpdated = walletUpdatedRows[0];
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
            source: "AFFILIATE_DEPOSIT_BONUS"
          } as Prisma.InputJsonValue
        }
      });

      await tx.referral.update({
        where: { id: referral.id },
        data: {
          bonusReceivedAtomic: { increment: bonusAtomic }
        }
      });
    });
  } catch (error) {
    if (isKnownRequestError(error, "P2002") || isMissingAffiliateSchemaError(error)) {
      return;
    }
    throw error;
  }
};

const isMissingColumnError = (error: unknown, token: string): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.toLowerCase().includes(token.toLowerCase());
};

export const getProfileSummary = async (userId: string) => {
  const user = await prisma.user
    .findUnique({
      where: { id: userId },
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
    })
    .catch(async (error) => {
      if (
        !isMissingColumnError(error, "profilevisible") &&
        !isMissingColumnError(error, "levelxpatomic") &&
        !isMissingColumnError(error, "publicid")
      ) {
        throw error;
      }
      return prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true
        }
      });
    });

  if (!user) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  const levelXpAtomic = "levelXpAtomic" in user ? user.levelXpAtomic : 0n;
  const profileVisible = "profileVisible" in user ? user.profileVisible : true;
  const publicId = "publicId" in user ? user.publicId : null;

  const [wallet, depositsAgg, withdrawalsAgg, minesAgg, blackjackAgg, rouletteAgg, referralAsReferred, referralAsReferrerAgg] =
    await Promise.all([
      prisma.wallet.findUnique({
        where: {
          userId_currency: {
            userId,
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
      prisma.deposit.aggregate({
        where: {
          userId,
          currency: PLATFORM_INTERNAL_CURRENCY,
          status: DepositStatus.COMPLETED
        },
        _sum: { amountAtomic: true }
      }),
      prisma.withdrawal.aggregate({
        where: {
          userId,
          currency: PLATFORM_INTERNAL_CURRENCY,
          status: WithdrawalStatus.COMPLETED
        },
        _sum: { amountAtomic: true, feeAtomic: true }
      }),
      prisma.minesGame.aggregate({
        where: { userId, currency: PLATFORM_INTERNAL_CURRENCY },
        _sum: { betAtomic: true, payoutAtomic: true }
      }),
      prisma.blackjackGame.aggregate({
        where: { userId, currency: PLATFORM_INTERNAL_CURRENCY },
        _sum: { initialBetAtomic: true, payoutAtomic: true }
      }),
      prisma.rouletteBet.aggregate({
        where: { userId, currency: PLATFORM_INTERNAL_CURRENCY },
        _sum: { stakeAtomic: true, payoutAtomic: true }
      }),
      prisma.referral
        .findUnique({
          where: { referredUserId: userId },
          select: {
            bonusReceivedAtomic: true
          }
        })
        .catch((error) => (isMissingAffiliateSchemaError(error) ? null : Promise.reject(error))),
      prisma.referral
        .aggregate({
          where: { referrerUserId: userId },
          _sum: {
            claimableCommissionAtomic: true,
            claimedCommissionAtomic: true
          }
        })
        .catch((error) =>
          isMissingAffiliateSchemaError(error)
            ? {
                _sum: {
                  claimableCommissionAtomic: 0n,
                  claimedCommissionAtomic: 0n
                }
              }
            : Promise.reject(error)
        )
    ]);

  const minesWagered = minesAgg._sum.betAtomic ?? 0n;
  const minesPayout = minesAgg._sum.payoutAtomic ?? 0n;
  const blackjackWagered = blackjackAgg._sum.initialBetAtomic ?? 0n;
  const blackjackPayout = blackjackAgg._sum.payoutAtomic ?? 0n;
  const rouletteWagered = rouletteAgg._sum.stakeAtomic ?? 0n;
  const roulettePayout = rouletteAgg._sum.payoutAtomic ?? 0n;
  const totalWageredAtomic = minesWagered + blackjackWagered + rouletteWagered;
  const totalPayoutAtomic = minesPayout + blackjackPayout + roulettePayout;

  const balanceAtomic = wallet?.balanceAtomic ?? 0n;
  const lockedAtomic = wallet?.lockedAtomic ?? 0n;
  const availableAtomic = balanceAtomic;

  return {
    user: {
      id: user.id,
      publicId,
      email: user.email,
      role: user.role,
      status: user.status,
      profileVisible,
      level: getLevelFromXp(levelXpAtomic),
      levelXpAtomic: levelXpAtomic.toString(),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    },
    wallet: {
      walletId: wallet?.id ?? null,
      balanceAtomic: balanceAtomic.toString(),
      lockedAtomic: lockedAtomic.toString(),
      availableAtomic: availableAtomic.toString(),
      updatedAt: wallet?.updatedAt ?? null
    },
    totals: {
      depositsAtomic: (depositsAgg._sum.amountAtomic ?? 0n).toString(),
      withdrawalsAtomic: (withdrawalsAgg._sum.amountAtomic ?? 0n).toString(),
      withdrawalFeesAtomic: (withdrawalsAgg._sum.feeAtomic ?? 0n).toString(),
      wageredAtomic: totalWageredAtomic.toString(),
      payoutAtomic: totalPayoutAtomic.toString(),
      netGamingAtomic: (totalPayoutAtomic - totalWageredAtomic).toString(),
      bonusFromReferralAtomic: (referralAsReferred?.bonusReceivedAtomic ?? 0n).toString(),
      claimableAffiliateCommissionAtomic: (
        referralAsReferrerAgg._sum.claimableCommissionAtomic ?? 0n
      ).toString(),
      claimedAffiliateCommissionAtomic: (
        referralAsReferrerAgg._sum.claimedCommissionAtomic ?? 0n
      ).toString()
    },
    perGame: {
      mines: {
        wageredAtomic: minesWagered.toString(),
        payoutAtomic: minesPayout.toString()
      },
      blackjack: {
        wageredAtomic: blackjackWagered.toString(),
        payoutAtomic: blackjackPayout.toString()
      },
      roulette: {
        wageredAtomic: rouletteWagered.toString(),
        payoutAtomic: roulettePayout.toString()
      }
    }
  };
};

export const setProfileVisibility = async (userId: string, profileVisible: boolean) => {
  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { profileVisible },
      select: { id: true, profileVisible: true, updatedAt: true }
    });
    return updated;
  } catch (error) {
    if (isMissingColumnError(error, "profilevisible")) {
      return {
        id: userId,
        profileVisible: true,
        updatedAt: new Date()
      };
    }
    throw error;
  }
};

export const ensureAffiliateSchemaReadyBestEffort = async (): Promise<void> => {
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profileVisible" BOOLEAN NOT NULL DEFAULT true');
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "affiliate_codes" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "affiliate_codes_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_codes_userId_key" ON "affiliate_codes"("userId")');
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_codes_code_key" ON "affiliate_codes"("code")');
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "affiliate_codes_code_idx" ON "affiliate_codes"("code")');
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "referrals" (
        "id" TEXT NOT NULL,
        "referrerUserId" TEXT NOT NULL,
        "referredUserId" TEXT NOT NULL,
        "affiliateCodeId" TEXT NOT NULL,
        "bonusReceivedAtomic" BIGINT NOT NULL DEFAULT 0,
        "totalWageredAtomic" BIGINT NOT NULL DEFAULT 0,
        "totalCommissionAtomic" BIGINT NOT NULL DEFAULT 0,
        "claimableCommissionAtomic" BIGINT NOT NULL DEFAULT 0,
        "claimedCommissionAtomic" BIGINT NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "referrals_referredUserId_key" ON "referrals"("referredUserId")');
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "referrals_referrerUserId_createdAt_idx" ON "referrals"("referrerUserId", "createdAt" DESC)');
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "affiliate_commission_events" (
        "id" TEXT NOT NULL,
        "referralId" TEXT NOT NULL,
        "referrerUserId" TEXT NOT NULL,
        "referredUserId" TEXT NOT NULL,
        "source" TEXT NOT NULL,
        "wagerAtomic" BIGINT NOT NULL,
        "commissionAtomic" BIGINT NOT NULL,
        "idempotencyKey" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "affiliate_commission_events_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_commission_events_idempotencyKey_key" ON "affiliate_commission_events"("idempotencyKey")');
  } catch {
    // ignored
  }
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "affiliate_deposit_bonuses" (
        "id" TEXT NOT NULL,
        "referralId" TEXT NOT NULL,
        "referredUserId" TEXT NOT NULL,
        "depositId" TEXT NOT NULL,
        "bonusAtomic" BIGINT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "affiliate_deposit_bonuses_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_deposit_bonuses_depositId_key" ON "affiliate_deposit_bonuses"("depositId")');
  } catch {
    // ignored
  }
};
