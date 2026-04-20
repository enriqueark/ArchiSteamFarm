import "@fastify/jwt";
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
  interface FastifyRequest {
    idempotencyKey?: string;
    serviceRole?: "GAME_ENGINE";
    rawBody?: string;
  }
}
