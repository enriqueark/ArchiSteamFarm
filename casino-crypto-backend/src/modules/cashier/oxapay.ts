import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "../../config/env";

export const CASHIER_PROVIDER = "OXAPAY";

export const CASHIER_ASSETS = ["BTC", "ETH", "USDT", "USDC", "SOL"] as const;
export type CashierAsset = (typeof CASHIER_ASSETS)[number];

export const CASHIER_NETWORKS = ["bitcoin", "erc20", "solana"] as const;
export type CashierNetwork = (typeof CASHIER_NETWORKS)[number];

export type CashierMethod = {
  asset: CashierAsset;
  network: CashierNetwork;
  networkLabel: string;
};

const CASHIER_METHODS: CashierMethod[] = [
  { asset: "BTC", network: "bitcoin", networkLabel: "Bitcoin" },
  { asset: "ETH", network: "erc20", networkLabel: "ERC-20" },
  { asset: "USDT", network: "erc20", networkLabel: "ERC-20" },
  { asset: "USDC", network: "erc20", networkLabel: "ERC-20" },
  { asset: "SOL", network: "solana", networkLabel: "Solana" }
];

export const getCashierMethods = (): CashierMethod[] => [...CASHIER_METHODS];

type OxaNetworkInfo = {
  network: string;
  name: string;
};

type OxaCurrencyInfo = {
  symbol: string;
  networks?: Record<string, OxaNetworkInfo>;
};

type OxaApiResponse<T> = {
  data?: T;
  error?: {
    message?: string;
  } | null;
  message?: string;
};

type OxaStaticAddressData = {
  track_id?: string | number;
  address?: string;
  network?: string;
  qr_code?: string;
};

type OxaPayoutData = {
  track_id?: string | number;
  status?: string;
};

let cachedCurrencies:
  | {
      at: number;
      map: Record<string, OxaCurrencyInfo>;
    }
  | null = null;

const CURRENCIES_CACHE_TTL_MS = 5 * 60_000;

const assertOxaConfigured = (mode: "merchant" | "payout"): void => {
  if (!env.OXAPAY_MERCHANT_API_KEY || !env.OXAPAY_PAYOUT_API_KEY || !env.OXAPAY_CALLBACK_BASE_URL) {
    throw new Error("OxaPay is not fully configured");
  }
  if (mode === "merchant" && !env.OXAPAY_MERCHANT_API_KEY) {
    throw new Error("OXAPAY_MERCHANT_API_KEY is missing");
  }
  if (mode === "payout" && !env.OXAPAY_PAYOUT_API_KEY) {
    throw new Error("OXAPAY_PAYOUT_API_KEY is missing");
  }
};

const doOxaRequest = async <T>(
  path: string,
  mode: "merchant" | "payout" | "public",
  body?: Record<string, unknown>
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.OXAPAY_HTTP_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (mode === "merchant") {
      assertOxaConfigured("merchant");
      headers.merchant_api_key = env.OXAPAY_MERCHANT_API_KEY as string;
    } else if (mode === "payout") {
      assertOxaConfigured("payout");
      headers.payout_api_key = env.OXAPAY_PAYOUT_API_KEY as string;
    }

    const response = await fetch(`${env.OXAPAY_API_BASE_URL}${path}`, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const payload = (await response.json().catch(() => ({}))) as OxaApiResponse<T>;
    if (!response.ok) {
      const message = payload.error?.message || payload.message || `OxaPay request failed (${response.status})`;
      throw new Error(message);
    }
    return payload.data as T;
  } finally {
    clearTimeout(timeout);
  }
};

const networkHintsByMethod = (method: CashierMethod): string[] => {
  if (method.network === "bitcoin") {
    return ["bitcoin", "bitcoin network", "btc"];
  }
  if (method.network === "solana") {
    return ["solana", "solana network", "sol"];
  }
  return ["ethereum", "erc20", "ethereum network", "eth"];
};

const resolveNetworkName = (
  method: CashierMethod,
  currencies: Record<string, OxaCurrencyInfo>
): { networkValue: string; networkLabel: string } => {
  const currency = currencies[method.asset];
  const networks = currency?.networks ?? {};
  const values = Object.values(networks);
  const hints = networkHintsByMethod(method);

  const found = values.find((candidate) => {
    const hay = `${candidate.network} ${candidate.name}`.toLowerCase();
    return hints.some((hint) => hay.includes(hint));
  });

  if (found) {
    return {
      networkValue: found.network,
      networkLabel: found.name || method.networkLabel
    };
  }

  if (method.network === "bitcoin") {
    return { networkValue: "bitcoin", networkLabel: "Bitcoin Network" };
  }
  if (method.network === "solana") {
    return { networkValue: "solana", networkLabel: "Solana Network" };
  }
  return { networkValue: "ethereum", networkLabel: "Ethereum Network" };
};

export const getOxaPaySupportedCurrencies = async (): Promise<Record<string, OxaCurrencyInfo>> => {
  if (cachedCurrencies && Date.now() - cachedCurrencies.at < CURRENCIES_CACHE_TTL_MS) {
    return cachedCurrencies.map;
  }

  const data = await doOxaRequest<Record<string, OxaCurrencyInfo>>("/common/currencies", "public");
  cachedCurrencies = {
    at: Date.now(),
    map: data
  };
  return data;
};

export const createOxaPayStaticAddress = async (input: {
  userId: string;
  email?: string;
  method: CashierMethod;
  callbackUrl: string;
}): Promise<{ trackId: string; address: string; networkLabel: string; qrCodeUrl: string | null }> => {
  const currencies = await getOxaPaySupportedCurrencies();
  const network = resolveNetworkName(input.method, currencies);
  const data = await doOxaRequest<OxaStaticAddressData>("/payment/static-address", "merchant", {
    network: network.networkValue,
    to_currency: "USDT",
    callback_url: input.callbackUrl,
    email: input.email,
    order_id: `user:${input.userId}:${input.method.asset}:${input.method.network}`,
    description: `cashier-static-address:${input.userId}:${input.method.asset}:${input.method.network}`
  });

  const trackId = data.track_id;
  const address = data.address?.trim();
  if ((!trackId && trackId !== 0) || !address) {
    throw new Error("Invalid OxaPay static address response");
  }

  return {
    trackId: String(trackId),
    address,
    networkLabel: data.network || network.networkLabel,
    qrCodeUrl: data.qr_code?.trim() || null
  };
};

export const createOxaPayPayout = async (input: {
  method: CashierMethod;
  destinationAddress: string;
  amountAsset: number;
  callbackUrl: string;
  description: string;
}): Promise<{ trackId: string; status: string }> => {
  const currencies = await getOxaPaySupportedCurrencies();
  const network = resolveNetworkName(input.method, currencies);
  const data = await doOxaRequest<OxaPayoutData>("/payout", "payout", {
    address: input.destinationAddress,
    currency: input.method.asset,
    amount: Number(input.amountAsset.toFixed(12)),
    network: network.networkValue,
    callback_url: input.callbackUrl,
    description: input.description
  });
  const trackId = data.track_id;
  if ((!trackId && trackId !== 0) || trackId === "") {
    throw new Error("Invalid OxaPay payout response");
  }
  return {
    trackId: String(trackId),
    status: data.status ?? "UNKNOWN"
  };
};

export const verifyOxaPayWebhookHmac = (
  rawBody: string | Buffer,
  receivedHmacHeader: string | undefined,
  secret: string | undefined
): boolean => {
  if (!receivedHmacHeader || !secret) {
    return false;
  }
  const raw = typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody;
  const expected = createHmac("sha512", secret).update(raw).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(receivedHmacHeader, "utf8");
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer);
};

