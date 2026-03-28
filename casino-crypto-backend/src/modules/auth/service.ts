import argon2 from "argon2";
import { Prisma } from "@prisma/client";
import { FastifyInstance } from "fastify";

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

const sanitizeUser = (user: {
  id: string;
  email: string;
  role: "PLAYER" | "ADMIN" | "SUPPORT";
  levelXpAtomic: bigint;
}): AuthUser => ({
  id: user.id,
  email: user.email,
  role: user.role,
  level: getLevelFromXp(user.levelXpAtomic),
  levelXpAtomic: user.levelXpAtomic.toString()
});

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
  fastify: FastifyInstance,
  input: { email: string; password: string; userAgent?: string; ipAddress?: string }
) => {
  const email = normalizeEmail(input.email);
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true }
  });

  if (existing) {
    throw new AppError("Email is already registered", 409, "EMAIL_ALREADY_EXISTS");
  }

  const passwordHash = await argon2.hash(input.password);

  let createdUser: AuthUser;
  let authIdentity: { id: string; email: string; role: "PLAYER" | "ADMIN" | "SUPPORT" };
  try {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash
      },
      select: {
        id: true,
        email: true,
        role: true,
        levelXpAtomic: true
      }
    });
    createdUser = sanitizeUser(user);
    authIdentity = { id: user.id, email: user.email, role: user.role };
  } catch (error) {
    if (!isMissingLevelXpColumnError(error)) {
      throw error;
    }
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash
      },
      select: {
        id: true,
        email: true,
        role: true
      }
    });
    createdUser = sanitizeLegacyUser(user);
    authIdentity = { id: user.id, email: user.email, role: user.role };
  }

  await createDefaultWallets(authIdentity.id);
  if (isCashierEnabled()) {
    await ensureUserDepositAddresses(authIdentity.id);
  }
  const tokens = await openSession(fastify, authIdentity, input.userAgent, input.ipAddress);

  return {
    user: createdUser,
    tokens
  };
};

export const login = async (
  fastify: FastifyInstance,
  input: { email: string; password: string; userAgent?: string; ipAddress?: string }
) => {
  const email = normalizeEmail(input.email);

  let user:
    | {
        id: string;
        email: string;
        passwordHash: string;
        role: "PLAYER" | "ADMIN" | "SUPPORT";
        status: "ACTIVE" | "SUSPENDED";
        levelXpAtomic: bigint;
      }
    | {
        id: string;
        email: string;
        passwordHash: string;
        role: "PLAYER" | "ADMIN" | "SUPPORT";
        status: "ACTIVE" | "SUSPENDED";
      }
    | null;
  try {
    user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        status: true,
        levelXpAtomic: true
      }
    });
  } catch (error) {
    if (!isMissingLevelXpColumnError(error)) {
      throw error;
    }
    user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        status: true
      }
    });
  }

  if (!user) {
    throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");
  }

  const passwordValid = await argon2.verify(user.passwordHash, input.password);

  if (!passwordValid) {
    throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");
  }

  if (user.status !== "ACTIVE") {
    throw new AppError("User is not active", 403, "USER_NOT_ACTIVE");
  }

  const sanitizedUser =
    "levelXpAtomic" in user ? sanitizeUser(user) : sanitizeLegacyUser(user);
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
