import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { AppError } from "../../core/errors";
import {
  getSupportedExternalAssets,
  getUsdRates,
  quoteDepositToCoins,
  quoteWithdrawFromCoins
} from "./service";

const assetSchema = z.enum(["BTC", "ETH", "USDT", "USDC", "SOL"]);

const depositQuoteSchema = z.object({
  asset: assetSchema,
  amountAtomic: z
    .string()
    .regex(/^\d+$/, "amountAtomic must be a positive integer string")
    .transform((value) => BigInt(value))
    .refine((value) => value > 0n, "amountAtomic must be greater than 0")
});

const withdrawalQuoteSchema = z.object({
  asset: assetSchema,
  coinsAtomic: z
    .string()
    .regex(/^\d+$/, "coinsAtomic must be a positive integer string")
    .transform((value) => BigInt(value))
    .refine((value) => value > 0n, "coinsAtomic must be greater than 0")
});

export const pricingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/rates", async (_request, reply) => {
    try {
      const snapshot = await getUsdRates();
      return reply.send({
        base: "USD",
        virtualCurrency: {
          symbol: "COINS",
          peg: "1 COIN = 1 USD",
          atomicDecimals: 8
        },
        assets: getSupportedExternalAssets(),
        rates: snapshot.rates,
        fetchedAt: new Date(snapshot.fetchedAt).toISOString()
      });
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : "Unable to load rates",
        502,
        "FX_RATE_PROVIDER_ERROR"
      );
    }
  });

  fastify.post("/quotes/deposit", async (request, reply) => {
    const body = depositQuoteSchema.parse(request.body);

    try {
      const quote = await quoteDepositToCoins(body.asset, body.amountAtomic);
      return reply.send({
        asset: quote.asset,
        amountAtomic: quote.amountAtomic.toString(),
        amountAsset: quote.amountAsset,
        usdRate: quote.usdRate,
        usdValue: quote.usdValue,
        coinsAtomic: quote.coinsAtomic.toString(),
        coins: quote.coins,
        fetchedAt: quote.fetchedAt.toISOString()
      });
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : "Unable to create deposit quote",
        400,
        "DEPOSIT_QUOTE_ERROR"
      );
    }
  });

  fastify.post("/quotes/withdraw", async (request, reply) => {
    const body = withdrawalQuoteSchema.parse(request.body);

    try {
      const quote = await quoteWithdrawFromCoins(body.asset, body.coinsAtomic);
      return reply.send({
        asset: quote.asset,
        coinsAtomic: quote.coinsAtomic.toString(),
        coins: quote.coins,
        usdRate: quote.usdRate,
        usdValue: quote.usdValue,
        amountAtomic: quote.amountAtomic.toString(),
        amountAsset: quote.amountAsset,
        fetchedAt: quote.fetchedAt.toISOString()
      });
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : "Unable to create withdrawal quote",
        400,
        "WITHDRAWAL_QUOTE_ERROR"
      );
    }
  });
};
