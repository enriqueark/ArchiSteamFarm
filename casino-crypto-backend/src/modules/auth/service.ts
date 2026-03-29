import argon2 from "argon2";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import { env } from "../../config/env";
import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";
import { ensureUserDepositAddresses, isCashierEnabled } from "../cashier/service";
import { getLevelFromXp } from "../progression/service";
import { createDefaultWallets } from "../wallets/service";

type AuthUser = {
  id: string;
  email: string;
  role: "PLAYER" | "ADMIN" | "SUPPORT";
  level: number;
  levelXpAtomic: string;
};

type TokenPair = {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
};

const DEFAULT_REFRESH_FALLBACK_MS = 7 * 24 * 60 * 60 * 1000;

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const isMissingLevelXpColumnError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
    const meta = error.meta as Record<string, unknown> | undefined;
    const metaText = `${String(meta?.column ?? "")} ${String(meta?.target ?? "")}`.toLowerCase();
    if (metaText.includes("levelxpatomic")) {
      return true;
    }
  }

  if (error instanceof Error) {
    return error.message.toLowerCase().includes("levelxpatomic");
  }

  return false;
};

const sanitizeLegacyUser = (user: {
  id: string;
  email: string;
  role: "PLAYER" | "ADMIN" | "SUPPORT";
}): AuthUser => ({
  id: user.id,
  email: user.email,
  role: user.role,
  level: 1,
  levelXpAtomic: "0"
});

const toBigIntSafe = (value: unknown): bigint => {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  return 0n;
};

const enrichUserWithProgression = async (user: {
  id: string;
  email: string;
  role: "PLAYER" | "ADMIN" | "SUPPORT";
}): Promise<AuthUser> => {
  try {
    const rows = await prisma.$queryRaw<Array<{ levelXpAtomic: unknown }>>`
      SELECT "levelXpAtomic"
      FROM "users"
      WHERE id = ${user.id}
      LIMIT 1
    `;
    const xp = toBigIntSafe(rows[0]?.levelXpAtomic ?? 0);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      level: getLevelFromXp(xp),
      levelXpAtomic: xp.toString()
    };
  } catch (error) {
    if (isMissingLevelXpColumnError(error)) {
      return sanitizeLegacyUser(user);
    }
    throw error;
  }
};

const isBcryptHash = (hash: string): boolean => /^\$2[aby]\$/.test(hash);

const verifyPasswordWithLegacySupport = async (
  storedHash: string,
  inputPassword: string
): Promise<{ valid: boolean; shouldUpgradeHash: boolean }> => {
  try {
    const valid = await argon2.verify(storedHash, inputPassword);
    return { valid, shouldUpgradeHash: false };
  } catch {
    // Continue with legacy hash strategies.
  }

  if (isBcryptHash(storedHash)) {
    const valid = await bcrypt.compare(inputPassword, storedHash).catch(() => false);
    return { valid, shouldUpgradeHash: valid };
  }

  // Last-resort legacy support for plain-text historical rows.
  if (storedHash === inputPassword) {
    return { valid: true, shouldUpgradeHash: true };
  }

  return { valid: false, shouldUpgradeHash: false };
};

const decodeExpiryDate = (fastify: FastifyInstance, token: string): Date => {
  const decoded = fastify.jwt.decode<{ exp?: number }>(token);

  if (decoded && typeof decoded === "object" && typeof decoded.exp === "number") {
    return new Date(decoded.exp * 1000);
  }

  return new Date(Date.now() + DEFAULT_REFRESH_FALLBACK_MS);
};

const issueTokenPair = async (
  fastify: FastifyInstance,
  user: { id: string; email: string; role: "PLAYER" | "ADMIN" | "SUPPORT" },
  sessionId: string
): Promise<TokenPair> => {
  const refreshJwt = (
    fastify.jwt as typeof fastify.jwt & {
      refresh: {
        sign: typeof fastify.jwt.sign;
        verify: typeof fastify.jwt.verify;
      };
    }
  ).refresh;

  const payload = {
    sub: user.id,
    role: user.role,
    sessionId,
    email: user.email
  };

  const accessToken = await fastify.jwt.sign(
    {
      ...payload,
      tokenType: "access"
    },
    {
      expiresIn: env.JWT_ACCESS_TTL
    }
  );

  const refreshToken = await refreshJwt.sign(
    {
      ...payload,
      tokenType: "refresh"
    },
    {
      expiresIn: env.JWT_REFRESH_TTL
    }
  );

  return {
    accessToken,
    refreshToken,
    sessionId
  };
};

const openSession = async (
  fastify: FastifyInstance,
  user: { id: string; email: string; role: "PLAYER" | "ADMIN" | "SUPPORT" },
  userAgent?: string,
  ipAddress?: string
): Promise<TokenPair> => {
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: "pending",
      userAgent,
      ipAddress,
      expiresAt: new Date(Date.now() + DEFAULT_REFRESH_FALLBACK_MS)
    }
  });

  const tokens = await issueTokenPair(fastify, user, session.id);
  const refreshTokenHash = await argon2.hash(tokens.refreshToken);
  const expiresAt = decodeExpiryDate(fastify, tokens.refreshToken);

  await prisma.session.update({
    where: {
      id: session.id
    },
    data: {
      refreshTokenHash,
      expiresAt
    }
  });

  return tokens;
};

export const register = async (
  _fastify: FastifyInstance,
  input: { email: string; password: string; userAgent?: string; ipAddress?: string }
) => {
  const email = normalizeEmail(input.email);
  const existingRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "users"
    WHERE email = ${email}
    LIMIT 1
  `;
  const existing = existingRows[0];

  if (existing) {
    throw new AppError("Email is already registered", 409, "EMAIL_ALREADY_EXISTS");
  }

  const passwordHash = await argon2.hash(input.password);
  const userId = randomUUID();

  try {
    await prisma.$executeRaw`
      INSERT INTO "users" (
        id,
        email,
        "passwordHash",
        role,
        status,
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${userId},
        ${email},
        ${passwordHash},
        CAST('PLAYER' AS "UserRole"),
        CAST('SUSPENDED' AS "UserStatus"),
        NOW(),
        NOW()
      )
    `;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError("Email is already registered", 409, "EMAIL_ALREADY_EXISTS");
    }
    throw error;
  }

  const authIdentity: { id: string; email: string; role: "PLAYER" | "ADMIN" | "SUPPORT" } = {
    id: userId,
    email,
    role: "PLAYER"
  };
  const createdUser = await enrichUserWithProgression(authIdentity);

  await createDefaultWallets(authIdentity.id);
  if (isCashierEnabled()) {
    await ensureUserDepositAddresses(authIdentity.id);
  }

  return {
    user: createdUser,
    pendingApproval: true,
    message: "Registration successful. Your account is pending admin approval."
  };
};

export const login = async (
  fastify: FastifyInstance,
  input: { email: string; password: string; userAgent?: string; ipAddress?: string }
) => {
  const email = normalizeEmail(input.email);
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      email: string;
      passwordHash: string;
      role: "PLAYER" | "ADMIN" | "SUPPORT";
      status: "ACTIVE" | "SUSPENDED";
    }>
  >`
    SELECT
      id,
      email,
      "passwordHash",
      role,
      status
    FROM "users"
    WHERE email = ${email}
    LIMIT 1
  `;
  const user = rows[0] ?? null;

  if (!user) {
    throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");
  }

  const passwordVerification = await verifyPasswordWithLegacySupport(user.passwordHash, input.password);
  if (!passwordVerification.valid) {
    throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");
  }

  if (user.status !== "ACTIVE") {
    throw new AppError("User is not active", 403, "USER_NOT_ACTIVE");
  }

  const sanitizedUser = await enrichUserWithProgression({
    id: user.id,
    email: user.email,
    role: user.role
  });
  if (passwordVerification.shouldUpgradeHash) {
    const upgradedHash = await argon2.hash(input.password);
    await prisma
      .$executeRaw`
        UPDATE "users"
        SET "passwordHash" = ${upgradedHash},
            "updatedAt" = NOW()
        WHERE id = ${user.id}
      `
      .catch(() => {
        // Do not block login if hash upgrade fails.
      });
  }
  const tokens = await openSession(fastify, sanitizedUser, input.userAgent, input.ipAddress);

  return {
    user: sanitizedUser,
    tokens
  };
};

export const refreshSession = async (
  fastify: FastifyInstance,
  refreshToken: string,
  userAgent?: string,
  ipAddress?: string
) => {
  const refreshJwt = (
    fastify.jwt as typeof fastify.jwt & {
      refresh: {
        sign: typeof fastify.jwt.sign;
        verify: typeof fastify.jwt.verify;
      };
    }
  ).refresh;

  const decoded = await refreshJwt.verify<{
    sub: string;
    role: "PLAYER" | "ADMIN" | "SUPPORT";
    sessionId: string;
    email: string;
    tokenType: "access" | "refresh";
  }>(refreshToken);

  if (decoded.tokenType !== "refresh") {
    throw new AppError("Invalid refresh token", 401, "INVALID_REFRESH_TOKEN");
  }

  const session = await prisma.session.findFirst({
    where: {
      id: decoded.sessionId,
      userId: decoded.sub,
      revokedAt: null
    }
  });

  if (!session) {
    throw new AppError("Invalid or revoked session", 401, "SESSION_REVOKED");
  }

  const validHash = await argon2.verify(session.refreshTokenHash, refreshToken);

  if (!validHash) {
    throw new AppError("Refresh token mismatch", 401, "REFRESH_TOKEN_MISMATCH");
  }

  const tokens = await issueTokenPair(
    fastify,
    {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role
    },
    session.id
  );

  await prisma.session.update({
    where: {
      id: session.id
    },
    data: {
      refreshTokenHash: await argon2.hash(tokens.refreshToken),
      expiresAt: decodeExpiryDate(fastify, tokens.refreshToken),
      userAgent,
      ipAddress
    }
  });

  return tokens;
};

export const logout = async (sessionId: string, userId: string): Promise<void> => {
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      userId,
      revokedAt: null
    },
    select: {
      id: true
    }
  });

  if (!session) {
    return;
  }

  await prisma.session.update({
    where: { id: session.id },
    data: {
      revokedAt: new Date()
    }
  });
};
