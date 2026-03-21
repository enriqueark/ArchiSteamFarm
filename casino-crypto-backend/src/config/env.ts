import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid PostgreSQL URL"),
  REDIS_URL: z.string().url("REDIS_URL must be a valid Redis URL"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters long"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters long"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),
  GAME_ENGINE_SERVICE_TOKEN: z
    .string()
    .min(32, "GAME_ENGINE_SERVICE_TOKEN must be at least 32 characters long")
    .default("replace_me_game_engine_token_at_least_32_chars"),
  GAME_ENGINE_PUBLIC_KEY: z
    .string()
    .min(32, "GAME_ENGINE_PUBLIC_KEY must contain a PEM or base64 SPKI public key")
    .default("replace_with_game_engine_ed25519_public_key_pem_or_base64_spki"),
  GAME_RESULT_SIGNATURE_MAX_AGE_SECONDS: z.coerce.number().int().positive().max(300).default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  ROULETTE_ROUND_OPEN_SECONDS: z.coerce.number().int().min(5).max(120).default(20),
  ROULETTE_CLOSE_TO_SPIN_SECONDS: z.coerce.number().int().min(1).max(30).default(3),
  ROULETTE_SPIN_SECONDS: z.coerce.number().int().min(2).max(30).default(8),
  ROULETTE_WORKER_TICK_MS: z.coerce.number().int().min(200).max(5000).default(1000)
});

const deriveSecretFallback = (label: string): string => {
  const source = process.env.JWT_SECRET ?? process.env.DATABASE_URL ?? randomBytes(32).toString("hex");
  return createHash("sha256").update(`${label}:${source}`).digest("hex");
};

const normalizedEnv = {
  ...process.env,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? process.env.JWT_SECRET ?? deriveSecretFallback("jwt-access"),
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? process.env.JWT_SECRET ?? deriveSecretFallback("jwt-refresh")
};

const parsed = envSchema.safeParse(normalizedEnv);

if (!parsed.success) {
  const errors = parsed.error.flatten().fieldErrors;
  throw new Error(`Invalid environment configuration: ${JSON.stringify(errors)}`);
}

export const env = parsed.data;
