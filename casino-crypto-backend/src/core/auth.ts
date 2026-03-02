import { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "./errors";

export const requireAuth = async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
  await request.jwtVerify();

  if (request.user.tokenType !== "access") {
    throw new AppError("Invalid token for this endpoint", 401, "INVALID_TOKEN_TYPE");
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
