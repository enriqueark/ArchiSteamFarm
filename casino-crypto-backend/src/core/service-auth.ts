import { timingSafeEqual } from "node:crypto";
import { FastifyReply, FastifyRequest } from "fastify";

import { env } from "../config/env";
import { AppError } from "./errors";

const GAME_ENGINE_ROLE = "GAME_ENGINE";

const secureEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
};

export const requireGameEngineService = async (
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> => {
  const roleHeader = request.headers["x-service-role"];
  const tokenHeader = request.headers["x-service-token"];

  if (typeof roleHeader !== "string" || roleHeader !== GAME_ENGINE_ROLE) {
    throw new AppError("Service role is not authorized for this operation", 403, "SERVICE_ROLE_FORBIDDEN");
  }

  if (typeof tokenHeader !== "string" || !secureEqual(tokenHeader, env.GAME_ENGINE_SERVICE_TOKEN)) {
    throw new AppError("Invalid service credentials", 403, "SERVICE_CREDENTIALS_INVALID");
  }

  request.serviceRole = GAME_ENGINE_ROLE;
};

export const GAME_ENGINE_SERVICE_ROLE = GAME_ENGINE_ROLE;
