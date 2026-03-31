import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";

import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";

const parseOtpLabel = (email: string): string => {
  const clean = email.trim();
  return clean.length > 0 ? clean : "player";
};

const OTP_ISSUER = "Crypto Casino";

const getUser2faRow = async (userId: string) =>
  prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
      twoFactorTempSecret: true
    }
  });

export const getTwoFactorState = async (userId: string) => {
  const row = await getUser2faRow(userId);
  return {
    enabled: Boolean(row?.twoFactorEnabled),
    setupPending: Boolean(row?.twoFactorTempSecret)
  };
};

export const beginTwoFactorSetup = async (userId: string) => {
  const row = await getUser2faRow(userId);
  if (!row) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  const secret = generateSecret();
  const otpauthUrl = generateURI({
    secret,
    issuer: OTP_ISSUER,
    label: parseOtpLabel(row.email)
  });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 220, margin: 1 });

  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorTempSecret: secret
    }
  });

  return {
    secret,
    otpauthUrl,
    qrDataUrl
  };
};

export const verifyTwoFactorSetup = async (userId: string, code: string) => {
  const row = await getUser2faRow(userId);
  const tempSecret = row?.twoFactorTempSecret ?? null;
  if (!tempSecret) {
    throw new AppError("2FA setup not initialized", 409, "TWO_FACTOR_SETUP_NOT_STARTED");
  }
  const valid = verifySync({
    token: code,
    secret: tempSecret
  }).valid;
  if (!valid) {
    throw new AppError("Invalid 2FA code", 400, "TWO_FACTOR_CODE_INVALID");
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabled: true,
      twoFactorSecret: tempSecret,
      twoFactorTempSecret: null
    }
  });

  return { enabled: true as const };
};

export const disableTwoFactor = async (userId: string, code: string) => {
  const row = await getUser2faRow(userId);
  const secret = row?.twoFactorSecret ?? null;
  if (!row?.twoFactorEnabled || !secret) {
    throw new AppError("2FA is not enabled", 409, "TWO_FACTOR_NOT_ENABLED");
  }
  const valid = verifySync({
    token: code,
    secret
  }).valid;
  if (!valid) {
    throw new AppError("Invalid 2FA code", 400, "TWO_FACTOR_CODE_INVALID");
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorTempSecret: null
    }
  });

  return { enabled: false as const };
};

export const verifyTwoFactorCode = async (userId: string, code: string): Promise<boolean> => {
  const row = await getUser2faRow(userId);
  const secret = row?.twoFactorSecret ?? null;
  if (!row?.twoFactorEnabled || !secret) {
    return false;
  }
  return verifySync({
    token: code,
    secret
  }).valid;
};

export const verifyLoginTwoFactorCode = verifyTwoFactorCode;
