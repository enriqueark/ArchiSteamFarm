import "@fastify/jwt";
import { FastifyJwtNamespace } from "@fastify/jwt";
import "fastify";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      role: "PLAYER" | "ADMIN" | "SUPPORT";
      sessionId: string;
      email: string;
      tokenType: "access" | "refresh";
    };
    user: {
      sub: string;
      role: "PLAYER" | "ADMIN" | "SUPPORT";
      sessionId: string;
      email: string;
      tokenType: "access" | "refresh";
      iat: number;
      exp: number;
    };
  }
}

declare module "fastify" {
  interface FastifyInstance extends FastifyJwtNamespace<{ namespace: "refresh" }> {}

  interface FastifyRequest {
    idempotencyKey?: string;
  }
}
