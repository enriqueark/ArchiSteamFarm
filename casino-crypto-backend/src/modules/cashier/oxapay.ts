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
  status?: number | string;
};

type OxaStaticAddressData = {
  track_id?: string | number;
  trackId?: string | number;
  address?: string;
  network?: string;
  qr_code?: string;
  qrCode?: string;
};

type OxaPayoutData = {
  track_id?: string | number;
  status?: string;
};

type OxaLegacyResponse<T extends Record<string, unknown>> = T & {
  result?: number | string;
  message?: string;
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
    const payloadStatus = Number(payload.status);
    const hasApiError =
      Boolean(payload.error?.message) ||
      (Number.isFinite(payloadStatus) && payloadStatus >= 400);
    if (!response.ok || hasApiError) {
      const message =
        payload.error?.message ||
        payload.message ||
        `OxaPay request failed (${response.status})`;
      throw new Error(message);
    }
    if (payload.data !== undefined) {
      return payload.data as T;
    }
    // Some public endpoints can reply with the payload as the root object.
    return payload as unknown as T;
  } finally {
    clearTimeout(timeout);
  }
};

const getOxaApiRootBaseUrl = (): string => env.OXAPAY_API_BASE_URL.replace(/\/v1\/?$/i, "");

const doOxaLegacyMerchantRequest = async <T extends Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>
): Promise<T> => {
  assertOxaConfigured("merchant");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.OXAPAY_HTTP_TIMEOUT_MS);
  try {
    const payloadBody = {
      merchant: env.OXAPAY_MERCHANT_API_KEY as string,
      ...body
    };
    const response = await fetch(`${getOxaApiRootBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payloadBody),
      signal: controller.signal
    });
    const payload = (await response.json().catch(() => ({}))) as OxaLegacyResponse<T>;
    if (!response.ok) {
      throw new Error(payload.message || `OxaPay legacy request failed (${response.status})`);
    }
    const resultCode = Number(payload.result);
    if (Number.isFinite(resultCode) && resultCode !== 100) {
      throw new Error(payload.message || `OxaPay legacy request failed (result=${resultCode})`);
    }
    return payload as T;
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeStaticAddressData = (
  raw: OxaStaticAddressData | Record<string, unknown>
): { trackId: string; address: string; networkLabel?: string; qrCodeUrl: string | null } | null => {
  const payload = raw as Record<string, unknown>;
  const nestedData =
    payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : null;
  const trackIdRaw = payload.track_id ?? payload.trackId ?? nestedData?.track_id ?? nestedData?.trackId;
  const addressRaw = payload.address ?? nestedData?.address;
  const networkRaw = payload.network ?? nestedData?.network;
  const qrCodeRaw = payload.qr_code ?? payload.qrCode ?? nestedData?.qr_code ?? nestedData?.qrCode;
  const address = typeof addressRaw === "string" ? addressRaw.trim() : "";
  if ((trackIdRaw === undefined || trackIdRaw === null || trackIdRaw === "") || !address) {
    return null;
  }
  return {
    trackId: String(trackIdRaw),
    address,
    networkLabel: typeof networkRaw === "string" ? networkRaw : undefined,
    qrCodeUrl: typeof qrCodeRaw === "string" && qrCodeRaw.trim() ? qrCodeRaw.trim() : null
  };
};

const withOptionalEmail = (
  payload: Record<string, unknown>,
  email: string | undefined
): Record<string, unknown> => {
  const trimmed = email?.trim();
  if (!trimmed) {
    return payload;
  }
  return {
    ...payload,
    email: trimmed
  };
};

const networkHintsByMethod = (method: CashierMethod): string[] => {
  if (method.network === "bitcoin") {
    return ["bitcoin", "bitcoin network", "btc"];
  }
  if (method.network === "solana") {
    return ["solana", "solana network", "sol"];
  }
  return ["ethereum", "erc20", "erc-20", "ethereum network", "eth"];
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
    return { networkValue: "BTC", networkLabel: "Bitcoin Network" };
  }
  if (method.network === "solana") {
    return { networkValue: "SOL", networkLabel: "Solana Network" };
  }
  return { networkValue: "ERC20", networkLabel: "ERC-20" };
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
  let currencies: Record<string, OxaCurrencyInfo> = {};
  try {
    currencies = await getOxaPaySupportedCurrencies();
  } catch {
    // Fallback to deterministic network mapping when currencies endpoint is unavailable.
    currencies = {};
  }
  const network = resolveNetworkName(input.method, currencies);
  const callbackUrl = input.callbackUrl.trim();
  const orderId = `user:${input.userId}:${input.method.asset}:${input.method.network}`;
  const description = `cashier-static-address:${input.userId}:${input.method.asset}:${input.method.network}`;
  const basePayloadWithCallback = {
    callback_url: callbackUrl,
    order_id: orderId,
    description
  };
  const basePayloadWithoutCallback = {
    order_id: orderId,
    description
  };
  const basePayloadCandidates = [
    withOptionalEmail(basePayloadWithCallback, input.email),
    basePayloadWithCallback,
    withOptionalEmail(basePayloadWithoutCallback, input.email),
    basePayloadWithoutCallback
  ];

  const networkFallbacks =
    input.method.network === "bitcoin"
      ? ["BTC", "bitcoin"]
      : input.method.network === "solana"
        ? ["SOL", "solana"]
        : ["ERC20", "erc20", "ETH", "ethereum"];
  const networkCandidates = Array.from(
    new Set([network.networkValue, input.method.network, ...networkFallbacks])
  )
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const payloads: Record<string, unknown>[] = [];
  for (const payloadBase of basePayloadCandidates) {
    for (const networkValue of networkCandidates) {
      payloads.push({ ...payloadBase, network: networkValue, to_currency: input.method.asset });
      payloads.push({ ...payloadBase, network: networkValue, currency: input.method.asset });
      payloads.push({ ...payloadBase, network: networkValue });
    }
    payloads.push({ ...payloadBase, currency: input.method.asset });
  }

  let lastError: unknown = null;
  for (const payload of payloads) {
    try {
      const data = await doOxaRequest<OxaStaticAddressData>("/payment/static-address", "merchant", payload);
      const normalized = normalizeStaticAddressData(data);
      if (!normalized) {
        throw new Error("Invalid OxaPay static address response");
      }
      return {
        trackId: normalized.trackId,
        address: normalized.address,
        networkLabel: normalized.networkLabel || network.networkLabel,
        qrCodeUrl: normalized.qrCodeUrl
      };
    } catch (error) {
      lastError = error;
    }
  }

  const legacyPayloads: Record<string, unknown>[] = [];
  const legacyEmail = input.email?.trim();
  for (const networkValue of networkCandidates) {
    const baseLegacy = {
      network: networkValue,
      currency: input.method.asset,
      orderId,
      description
    };
    legacyPayloads.push({
      ...baseLegacy,
      callbackUrl
    });
    if (legacyEmail) {
      legacyPayloads.push({
        ...baseLegacy,
        callbackUrl,
        email: legacyEmail
      });
    }
    legacyPayloads.push(baseLegacy);
  }

  for (const payload of legacyPayloads) {
    try {
      const data = await doOxaLegacyMerchantRequest<Record<string, unknown>>(
        "/merchants/request/staticaddress",
        payload
      );
      const normalized = normalizeStaticAddressData(data);
      if (!normalized) {
        throw new Error("Invalid OxaPay legacy static address response");
      }
      return {
        trackId: normalized.trackId,
        address: normalized.address,
        networkLabel: normalized.networkLabel || network.networkLabel,
        qrCodeUrl: normalized.qrCodeUrl
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Unable to create OxaPay static address");
};

export const createOxaPayPayout = async (input: {
  method: CashierMethod;
  destinationAddress: string;
  amountAsset: number;
  callbackUrl: string;
  description: string;
}): Promise<{ trackId: string; status: string }> => {
  let currencies: Record<string, OxaCurrencyInfo> = {};
  try {
    currencies = await getOxaPaySupportedCurrencies();
  } catch {
    // Fallback to deterministic network mapping when currencies endpoint is unavailable.
    currencies = {};
  }
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

