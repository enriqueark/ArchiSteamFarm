import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../core/auth";
import { AppError } from "../../core/errors";
import { requireIdempotencyKey } from "../../core/idempotency";
import {
  CASHIER_ASSETS
} from "./oxapay";
import {
  createCashierWithdrawal,
  listUserCashierDepositAddresses,
  processPaymentWebhook,
  processPayoutWebhook,
  validatePaymentWebhookOrThrow,
  validatePayoutWebhookOrThrow
} from "./service";

const NETWORKS = ["bitcoin", "erc20", "solana"] as const;
const payoutAssetSchema = z.enum(CASHIER_ASSETS);

const requestWithdrawSchema = z.object({
  asset: payoutAssetSchema,
  network: z.enum(NETWORKS),
  amountCoins: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "amountCoins must be a numeric string")
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, "amountCoins must be greater than 0"),
  destinationAddress: z.string().trim().min(8).max(256)
});

const getIdempotencyKey = (request: { idempotencyKey?: string }): string => {
  if (!request.idempotencyKey) {
    throw new AppError("Idempotency-Key header is required", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }
  return request.idempotencyKey;
};

type OxaPayPaymentWebhookTx = {
  status?: string;
  tx_hash?: string;
  confirmations?: number;
  currency?: string;
  network?: string;
  sender_address?: string;
  address?: string;
  auto_convert_amount?: number;
  value?: number;
};

type OxaPayPaymentWebhookPayload = {
  type?: string;
  status?: string;
  track_id?: string | number;
  amount?: number;
  currency?: string;
  network?: string;
  txs?: OxaPayPaymentWebhookTx[];
  date?: number;
};

type OxaPayPayoutWebhookPayload = {
  type?: string;
  status?: string;
  track_id?: string | number;
  tx_hash?: string;
  address?: string;
  amount?: number;
  currency?: string;
  network?: string;
  date?: number;
};

const normalizeRawBody = (rawBody: string | undefined, body: unknown): string => {
  if (typeof rawBody === "string") {
    return rawBody;
  }
  if (typeof body === "string") {
    return body;
  }
  if (Buffer.isBuffer(body)) {
    return body.toString("utf8");
  }
  return JSON.stringify(body ?? {});
};

export const cashierRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/deposit-addresses", { preHandler: requireAuth }, async (request, reply) => {
    const addresses = await listUserCashierDepositAddresses(request.user.sub);
    return reply.send({ addresses });
  });

  fastify.get("/deposit-addresses/current", { preHandler: requireAuth }, async (request, reply) => {
    const addresses = await listUserCashierDepositAddresses(request.user.sub);
    return reply.send({ addresses });
  });

  fastify.post(
    "/withdrawals",
    {
      preHandler: [requireAuth, requireIdempotencyKey]
    },
    async (request, reply) => {
      const body = requestWithdrawSchema.parse(request.body);
      const coinsAtomic = BigInt(Math.round(body.amountCoins * 10 ** 8)).toString();
      const created = await createCashierWithdrawal({
        userId: request.user.sub,
        asset: body.asset,
        network: body.network,
        destinationAddress: body.destinationAddress,
        amountAtomic: coinsAtomic,
        idempotencyKey: getIdempotencyKey(request)
      });
      return reply.code(201).send(created);
    }
  );

  fastify.post("/webhooks/oxapay/payment", async (request, reply) => {
    const rawBody = normalizeRawBody(request.rawBody, request.body);
    request.log.info(
      {
        hasRawBody: typeof request.rawBody === "string",
        rawBodyLength: rawBody.length,
        hmacHeaderType: typeof request.headers.hmac
      },
      "cashier.payment_webhook_received"
    );
    const hmacHeader = request.headers.hmac;
    const hmacValue = Array.isArray(hmacHeader) ? hmacHeader[0] : hmacHeader;
    validatePaymentWebhookOrThrow(rawBody, hmacValue);
    const payload = JSON.parse(rawBody) as OxaPayPaymentWebhookPayload;
    await processPaymentWebhook(payload);
    return reply.code(200).type("text/plain").send("ok");
  });

  fastify.post("/webhooks/oxapay/payout", async (request, reply) => {
    const rawBody = normalizeRawBody(request.rawBody, request.body);
    request.log.info(
      {
        hasRawBody: typeof request.rawBody === "string",
        rawBodyLength: rawBody.length,
        hmacHeaderType: typeof request.headers.hmac
      },
      "cashier.payout_webhook_received"
    );
    const hmacHeader = request.headers.hmac;
    const hmacValue = Array.isArray(hmacHeader) ? hmacHeader[0] : hmacHeader;
    validatePayoutWebhookOrThrow(rawBody, hmacValue);
    const payload = JSON.parse(rawBody) as OxaPayPayoutWebhookPayload;
    await processPayoutWebhook(payload);
    return reply.code(200).type("text/plain").send("ok");
  });
};
