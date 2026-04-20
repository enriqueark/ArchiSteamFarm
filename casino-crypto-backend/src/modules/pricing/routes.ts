import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const assetSchema = z.literal("COINS");
const COIN_DECIMALS = 8;
const USD_PER_COIN = 0.7;

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
    return reply.send({
      base: "USD",
      virtualCurrency: {
        symbol: "COINS",
        peg: `1 COIN = ${USD_PER_COIN} USD`,
        usdPerCoin: USD_PER_COIN,
        atomicDecimals: COIN_DECIMALS
      },
      assets: ["COINS"],
      rates: { COINS: USD_PER_COIN },
      fetchedAt: new Date().toISOString()
    });
  });

  fastify.post("/quotes/deposit", async (request, reply) => {
    const body = depositQuoteSchema.parse(request.body);

    const coins = Number(body.amountAtomic) / 10 ** COIN_DECIMALS;
    const usdValue = coins * USD_PER_COIN;
    return reply.send({
      asset: body.asset,
      amountAtomic: body.amountAtomic.toString(),
      amountAsset: coins,
      usdRate: USD_PER_COIN,
      usdValue,
      coinsAtomic: body.amountAtomic.toString(),
      coins,
      fetchedAt: new Date().toISOString()
    });
  });

  fastify.post("/quotes/withdraw", async (request, reply) => {
    const body = withdrawalQuoteSchema.parse(request.body);

    const coins = Number(body.coinsAtomic) / 10 ** COIN_DECIMALS;
    const usdValue = coins * USD_PER_COIN;
    return reply.send({
      asset: body.asset,
      coinsAtomic: body.coinsAtomic.toString(),
      coins,
      usdRate: USD_PER_COIN,
      usdValue,
      amountAtomic: body.coinsAtomic.toString(),
      amountAsset: coins,
      fetchedAt: new Date().toISOString()
    });
  });
};
