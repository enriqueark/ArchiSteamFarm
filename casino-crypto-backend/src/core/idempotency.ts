import { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "./errors";

const IDEMPOTENCY_KEY_REGEX = /^[a-zA-Z0-9:_-]{8,128}$/;

export const requireIdempotencyKey = async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
  const headerValue = request.headers["idempotency-key"];

  if (typeof headerValue !== "string") {
    throw new AppError("Idempotency-Key header is required", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }

  if (!IDEMPOTENCY_KEY_REGEX.test(headerValue)) {
    throw new AppError("Invalid Idempotency-Key", 400, "IDEMPOTENCY_KEY_INVALID");
  }

  request.idempotencyKey = headerValue;
};
