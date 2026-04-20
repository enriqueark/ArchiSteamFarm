import { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "./errors";
import { prisma } from "../infrastructure/db/prisma";

export const requireAuth = async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
  await request.jwtVerify();

  if (request.user.tokenType !== "access") {
    throw new AppError("Invalid token for this endpoint", 401, "INVALID_TOKEN_TYPE");
  }

  if (!request.user.sessionId || typeof request.user.sessionId !== "string") {
    throw new AppError("Invalid session", 401, "INVALID_SESSION");
  }

  const session = await prisma.session.findFirst({
    where: {
      id: request.user.sessionId,
      userId: request.user.sub,
      revokedAt: null
    },
    select: {
      id: true
    }
  });

  if (!session) {
    throw new AppError("Session revoked", 401, "SESSION_REVOKED");
  }
};

export const requireRoles =
  (roles: Array<"PLAYER" | "ADMIN" | "SUPPORT">) =>
  async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    await requireAuth(request, _reply);

    if (!roles.includes(request.user.role)) {
      throw new AppError("You do not have permission to perform this operation", 403, "FORBIDDEN");
    }
  };
