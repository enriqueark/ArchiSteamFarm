type ExternalAsset = "BTC" | "ETH" | "USDT" | "USDC" | "SOL";

const COINS_ATOMIC_DECIMALS = 8;
const RATES_TTL_MS = 60_000;

const ASSET_TO_COINGECKO_ID: Record<ExternalAsset, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  USDT: "tether",
  USDC: "usd-coin",
  SOL: "solana"
};

const ASSET_ATOMIC_DECIMALS: Record<ExternalAsset, number> = {
  BTC: 8,
  ETH: 18,
  USDT: 6,
  USDC: 6,
  SOL: 9
};

type RatesSnapshot = {
  rates: Record<ExternalAsset, number>;
  fetchedAt: number;
};

let cache: RatesSnapshot | null = null;

const toDecimalAmount = (atomic: bigint, decimals: number): number => Number(atomic) / 10 ** decimals;
const toAtomic = (amount: number, decimals: number): bigint => BigInt(Math.floor(amount * 10 ** decimals));

export const getSupportedExternalAssets = (): ExternalAsset[] => ["BTC", "ETH", "USDT", "USDC", "SOL"];

export const getUsdRates = async (forceRefresh = false): Promise<RatesSnapshot> => {
  const now = Date.now();
  if (!forceRefresh && cache && now - cache.fetchedAt < RATES_TTL_MS) {
    return cache;
  }

  const ids = Object.values(ASSET_TO_COINGECKO_ID).join(",");
  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
    {
      headers: {
        Accept: "application/json"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Unable to fetch rates from provider (${response.status})`);
  }

  const payload = (await response.json()) as Record<string, { usd?: number }>;
  const rates: Record<ExternalAsset, number> = {
    BTC: payload[ASSET_TO_COINGECKO_ID.BTC]?.usd ?? 0,
    ETH: payload[ASSET_TO_COINGECKO_ID.ETH]?.usd ?? 0,
    USDT: payload[ASSET_TO_COINGECKO_ID.USDT]?.usd ?? 1,
    USDC: payload[ASSET_TO_COINGECKO_ID.USDC]?.usd ?? 1,
    SOL: payload[ASSET_TO_COINGECKO_ID.SOL]?.usd ?? 0
  };

  for (const [asset, usd] of Object.entries(rates) as Array<[ExternalAsset, number]>) {
    if (!Number.isFinite(usd) || usd <= 0) {
      throw new Error(`Invalid USD rate for ${asset}`);
    }
  }

  cache = { rates, fetchedAt: now };
  return cache;
};

export const quoteDepositToCoins = async (asset: ExternalAsset, amountAtomic: bigint) => {
  if (amountAtomic <= 0n) {
    throw new Error("amountAtomic must be greater than 0");
  }

  const { rates, fetchedAt } = await getUsdRates();
  const assetAmount = toDecimalAmount(amountAtomic, ASSET_ATOMIC_DECIMALS[asset]);
  const usdValue = assetAmount * rates[asset];
  const coinsAtomic = toAtomic(usdValue, COINS_ATOMIC_DECIMALS);

  return {
    asset,
    amountAtomic,
    amountAsset: assetAmount,
    usdRate: rates[asset],
    usdValue,
    coinsAtomic,
    coins: Number(coinsAtomic) / 10 ** COINS_ATOMIC_DECIMALS,
    fetchedAt: new Date(fetchedAt)
  };
};

export const quoteWithdrawFromCoins = async (asset: ExternalAsset, coinsAtomic: bigint) => {
  if (coinsAtomic <= 0n) {
    throw new Error("coinsAtomic must be greater than 0");
  }

  const { rates, fetchedAt } = await getUsdRates();
  const usdValue = toDecimalAmount(coinsAtomic, COINS_ATOMIC_DECIMALS);
  const amountAsset = usdValue / rates[asset];
  const amountAtomic = toAtomic(amountAsset, ASSET_ATOMIC_DECIMALS[asset]);

  return {
    asset,
    coinsAtomic,
    coins: usdValue,
    usdValue,
    usdRate: rates[asset],
    amountAtomic,
    amountAsset: Number(amountAtomic) / 10 ** ASSET_ATOMIC_DECIMALS[asset],
    fetchedAt: new Date(fetchedAt)
  };
};
