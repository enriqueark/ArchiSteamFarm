type ExternalAsset = "BTC" | "ETH" | "USDT" | "USDC" | "SOL";

const COINS_ATOMIC_DECIMALS = 8;
const USD_PER_COIN = 0.7;

const ASSET_ATOMIC_DECIMALS: Record<ExternalAsset, number> = {
  BTC: 8,
  ETH: 18,
  USDT: 6,
  USDC: 6,
  SOL: 9
};

const toDecimalAmount = (atomic: bigint, decimals: number): number => Number(atomic) / 10 ** decimals;
const toAtomic = (amount: number, decimals: number): bigint => BigInt(Math.floor(amount * 10 ** decimals));

export const getSupportedExternalAssets = (): ExternalAsset[] => ["BTC", "ETH", "USDT", "USDC", "SOL"];

export const getUsdRates = async (_forceRefresh = false): Promise<{ rates: Record<ExternalAsset, number>; fetchedAt: number }> => {
  // Keep fixed snapshot rates to avoid exposing live multi-currency behavior.
  // Deposits/withdrawals are disabled in product for now and only internal COINS are used.
  const now = Date.now();
  return {
    rates: {
      BTC: 0,
      ETH: 0,
      USDT: 1,
      USDC: 1,
      SOL: 0
    },
    fetchedAt: now
  };
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
