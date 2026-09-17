type ExternalAsset = "BTC" | "ETH" | "USDT" | "USDC" | "SOL" | "LTC";

const COINS_ATOMIC_DECIMALS = 8;
export const USD_PER_COIN = 0.6;
const RATES_TTL_MS = 60_000;
const RATES_TIMEOUT_MS = 8_000;

const ASSET_ATOMIC_DECIMALS: Record<ExternalAsset, number> = {
  BTC: 8,
  ETH: 18,
  USDT: 6,
  USDC: 6,
  SOL: 9,
  LTC: 8
};

const toDecimalAmount = (atomic: bigint, decimals: number): number => Number(atomic) / 10 ** decimals;
const toAtomic = (amount: number, decimals: number): bigint => BigInt(Math.floor(amount * 10 ** decimals));

export const getSupportedExternalAssets = (): ExternalAsset[] => ["BTC", "ETH", "USDT", "USDC", "SOL", "LTC"];

let ratesCache:
  | {
      rates: Record<ExternalAsset, number>;
      fetchedAt: number;
    }
  | null = null;

const FALLBACK_RATES: Record<ExternalAsset, number> = {
  BTC: 0,
  ETH: 0,
  USDT: 1,
  USDC: 1,
  SOL: 0,
  LTC: 0
};

const fetchUsdRates = async (): Promise<Record<ExternalAsset, number>> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RATES_TIMEOUT_MS);
  try {
    const url =
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether,usd-coin,solana,litecoin&vs_currencies=usd";
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch rates (${response.status})`);
    }
    const payload = (await response.json()) as Record<string, { usd?: number }>;
    const parsed: Record<ExternalAsset, number> = {
      BTC: Number(payload.bitcoin?.usd ?? 0),
      ETH: Number(payload.ethereum?.usd ?? 0),
      USDT: Number(payload.tether?.usd ?? 1),
      USDC: Number(payload["usd-coin"]?.usd ?? 1),
      SOL: Number(payload.solana?.usd ?? 0),
      LTC: Number(payload.litecoin?.usd ?? 0)
    };
    const hasCoreRates =
      Number.isFinite(parsed.BTC) &&
      parsed.BTC > 0 &&
      Number.isFinite(parsed.ETH) &&
      parsed.ETH > 0 &&
      Number.isFinite(parsed.SOL) &&
      parsed.SOL > 0 &&
      Number.isFinite(parsed.LTC) &&
      parsed.LTC > 0;
    if (!hasCoreRates) {
      throw new Error("Incomplete price payload");
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
};

export const getUsdRates = async (_forceRefresh = false): Promise<{ rates: Record<ExternalAsset, number>; fetchedAt: number }> => {
  const now = Date.now();
  if (!_forceRefresh && ratesCache && now - ratesCache.fetchedAt < RATES_TTL_MS) {
    return {
      rates: ratesCache.rates,
      fetchedAt: ratesCache.fetchedAt
    };
  }
  try {
    const rates = await fetchUsdRates();
    ratesCache = {
      rates,
      fetchedAt: now
    };
    return {
      rates,
      fetchedAt: now
    };
  } catch {
    if (ratesCache) {
      return {
        rates: ratesCache.rates,
        fetchedAt: ratesCache.fetchedAt
      };
    }
    return {
      rates: FALLBACK_RATES,
      fetchedAt: now
    };
  }
};

export const quoteDepositToCoins = async (asset: ExternalAsset, amountAtomic: bigint) => {
  if (amountAtomic <= 0n) {
    throw new Error("amountAtomic must be greater than 0");
  }

  const { rates, fetchedAt } = await getUsdRates();
  if (!Number.isFinite(rates[asset]) || rates[asset] <= 0) {
    throw new Error(`${asset} is currently unsupported`);
  }
  const assetAmount = toDecimalAmount(amountAtomic, ASSET_ATOMIC_DECIMALS[asset]);
  const usdValue = assetAmount * rates[asset];
  const coinsAtomic = toAtomic(usdValue / USD_PER_COIN, COINS_ATOMIC_DECIMALS);

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
  if (!Number.isFinite(rates[asset]) || rates[asset] <= 0) {
    throw new Error(`${asset} is currently unsupported`);
  }
  const coinAmount = toDecimalAmount(coinsAtomic, COINS_ATOMIC_DECIMALS);
  const usdValue = coinAmount * USD_PER_COIN;
  const amountAsset = usdValue / rates[asset];
  const amountAtomic = toAtomic(amountAsset, ASSET_ATOMIC_DECIMALS[asset]);

  return {
    asset,
    coinsAtomic,
    coins: coinAmount,
    usdValue,
    usdRate: rates[asset],
    amountAtomic,
    amountAsset: Number(amountAtomic) / 10 ** ASSET_ATOMIC_DECIMALS[asset],
    fetchedAt: new Date(fetchedAt)
  };
};
