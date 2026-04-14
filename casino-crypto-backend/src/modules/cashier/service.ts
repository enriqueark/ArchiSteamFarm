import { DepositStatus, LedgerReason, Prisma, WithdrawalStatus } from "@prisma/client";
import { createHash } from "node:crypto";

import { env } from "../../config/env";
import { AppError } from "../../core/errors";
import { prisma } from "../../infrastructure/db/prisma";
import { adjustWalletBalance } from "../ledger/service";
import { quoteDepositToCoins, quoteWithdrawFromCoins } from "../pricing/service";
import { applyReferralDepositBonusBestEffort } from "../affiliates/service";
import { PLATFORM_INTERNAL_CURRENCY } from "../wallets/service";
import { ensureUserAllowedFor } from "../users/access-guard";
import {
  CASHIER_PROVIDER,
  createOxaPayPayout,
  createOxaPayStaticAddress,
  getCashierMethods,
  verifyOxaPayWebhookHmac,
  type CashierAsset,
  type CashierMethod
} from "./oxapay";

const COINS_DECIMALS = 8;

const ASSET_DECIMALS: Record<CashierAsset, number> = {
  BTC: 8,
  ETH: 18,
  USDT: 6,
  USDC: 6,
  SOL: 9
};

export type UserCashierAddress = {
  asset: string;
  network: string;
  networkLabel: string;
  address: string;
  providerTrackId: string;
  qrCodeUrl: string | null;
};

export type OxaPayPaymentWebhookTx = {
  status?: string;
  tx_hash?: string;
  confirmations?: number;
  currency?: string;
  network?: string;
  sender_address?: string;
  address?: string;
  sent_amount?: number;
  auto_convert_amount?: number;
  value?: number;
};

export type OxaPayPaymentWebhookPayload = {
  type?: string;
  status?: string;
  track_id?: string | number;
  amount?: number;
  value?: number;
  currency?: string;
  network?: string;
  txs?: OxaPayPaymentWebhookTx[];
  date?: number;
};

export type OxaPayPayoutWebhookPayload = {
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

const toCoinsAtomicFromDecimal = (value: number): bigint => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0n;
  }
  return BigInt(Math.floor(value * 10 ** COINS_DECIMALS));
};

const toAssetAtomic = (value: number, decimals: number): bigint => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0n;
  }
  return BigInt(Math.floor(value * 10 ** decimals));
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
};

const callbackFingerprint = (payload: unknown): string =>
  createHash("sha256").update(stableStringify(payload)).digest("hex");

const getMethodOrThrow = (asset: string, network: string): CashierMethod => {
  const method = getCashierMethods().find(
    (candidate) =>
      candidate.asset === asset.trim().toUpperCase() &&
      candidate.network === network.trim().toLowerCase()
  );
  if (!method) {
    throw new AppError(
      `Unsupported cashier method ${asset.toUpperCase()} on ${network.toLowerCase()}`,
      400,
      "CASHIER_METHOD_UNSUPPORTED"
    );
  }
  return method;
};

const getUsdtWalletOrThrow = async (userId: string): Promise<{ id: string }> => {
  const wallet = await prisma.wallet.findUnique({
    where: {
      userId_currency: {
        userId,
        currency: PLATFORM_INTERNAL_CURRENCY
      }
    },
    select: {
      id: true
    }
  });
  if (!wallet) {
    throw new AppError("Wallet not found", 404, "WALLET_NOT_FOUND");
  }
  return wallet;
};

const toAddressDto = (entry: {
  asset: string;
  network: string;
  networkLabel: string;
  address: string;
  providerTrackId: string;
  qrCodeUrl: string | null;
}): UserCashierAddress => ({
  asset: entry.asset,
  network: entry.network,
  networkLabel: entry.networkLabel,
  address: entry.address,
  providerTrackId: entry.providerTrackId,
  qrCodeUrl: entry.qrCodeUrl
});

export const isCashierEnabled = (): boolean =>
  Boolean(env.OXAPAY_MERCHANT_API_KEY && env.OXAPAY_PAYOUT_API_KEY && env.OXAPAY_CALLBACK_BASE_URL);

export const ensureUserDepositAddresses = async (userId: string): Promise<UserCashierAddress[]> => {
  if (!isCashierEnabled()) {
    return [];
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true }
  });
  if (!user) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  const existing = await prisma.paymentAddress.findMany({
    where: {
      userId,
      provider: CASHIER_PROVIDER
    },
    select: {
      asset: true,
      network: true,
      networkLabel: true,
      address: true,
      providerTrackId: true,
      qrCodeUrl: true
    }
  });
  const byPair = new Map(existing.map((entry) => [`${entry.asset}:${entry.network}`, true]));

  const callbackUrl = `${env.OXAPAY_CALLBACK_BASE_URL!.replace(/\/+$/, "")}/api/v1/cashier/webhooks/oxapay/payment`;
  for (const method of getCashierMethods()) {
    const pair = `${method.asset}:${method.network}`;
    if (byPair.has(pair)) {
      continue;
    }
    const remote = await createOxaPayStaticAddress({
      userId,
      email: user.email,
      method,
      callbackUrl
    });
    try {
      await prisma.paymentAddress.create({
        data: {
          userId,
          provider: CASHIER_PROVIDER,
          asset: method.asset,
          network: method.network,
          networkLabel: remote.networkLabel,
          address: remote.address,
          providerTrackId: remote.trackId,
          callbackUrl,
          qrCodeUrl: remote.qrCodeUrl
        }
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
    }
  }

  const refreshed = await prisma.paymentAddress.findMany({
    where: {
      userId,
      provider: CASHIER_PROVIDER
    },
    select: {
      asset: true,
      network: true,
      networkLabel: true,
      address: true,
      providerTrackId: true,
      qrCodeUrl: true
    },
    orderBy: [{ asset: "asc" }, { network: "asc" }]
  });
  return refreshed.map(toAddressDto);
};

export const listUserCashierDepositAddresses = async (userId: string): Promise<UserCashierAddress[]> =>
  ensureUserDepositAddresses(userId);

export const createCashierWithdrawal = async (input: {
  userId: string;
  asset: CashierAsset;
  network: string;
  destinationAddress: string;
  amountAtomic: string;
  idempotencyKey: string;
}) => {
  if (!isCashierEnabled()) {
    throw new AppError("Cashier service is disabled", 503, "CASHIER_DISABLED");
  }

  await ensureUserAllowedFor(input.userId, "WITHDRAW");

  const userFlags = await prisma.user
    .findUnique({
      where: { id: input.userId },
      select: { canWithdraw: true }
    })
    .catch(() => null);
  if (userFlags && userFlags.canWithdraw === false) {
    throw new AppError("Withdrawals are disabled for this account", 403, "WITHDRAWALS_DISABLED_FOR_USER");
  }

  const method = getMethodOrThrow(input.asset, input.network);
  const coinsAtomic = BigInt(input.amountAtomic);
  if (coinsAtomic <= 0n) {
    throw new AppError("amountAtomic must be positive", 400, "INVALID_AMOUNT");
  }

  const wallet = await getUsdtWalletOrThrow(input.userId);
  const existing = await prisma.withdrawal.findFirst({
    where: {
      userId: input.userId,
      idempotencyKey: input.idempotencyKey
    }
  });
  if (existing) {
    return {
      id: existing.id,
      status: existing.status,
      amountAtomic: existing.amountAtomic.toString(),
      asset: existing.asset ?? method.asset,
      network: existing.network,
      destinationAddress: existing.destinationAddress,
      providerTrackId: existing.providerTrackId
    };
  }

  const quote = await quoteWithdrawFromCoins(method.asset, coinsAtomic);
  if (quote.amountAtomic <= 0n) {
    throw new AppError("Converted withdrawal amount is too low", 400, "WITHDRAW_AMOUNT_TOO_LOW");
  }

  const created = await prisma.withdrawal.create({
    data: {
      userId: input.userId,
      walletId: wallet.id,
      currency: PLATFORM_INTERNAL_CURRENCY,
      asset: method.asset,
      network: method.network,
      destinationAddress: input.destinationAddress,
      amountAtomic: coinsAtomic,
      status: WithdrawalStatus.PENDING,
      idempotencyKey: input.idempotencyKey,
      metadata: {
        provider: CASHIER_PROVIDER,
        payoutAmountAtomic: quote.amountAtomic.toString(),
        payoutAmountAsset: quote.amountAsset,
        payoutAsset: method.asset,
        payoutNetwork: method.network
      }
    }
  });

  const debit = await adjustWalletBalance({
    actorUserId: input.userId,
    userId: input.userId,
    currency: PLATFORM_INTERNAL_CURRENCY,
    amountAtomic: -coinsAtomic,
    reason: LedgerReason.WITHDRAWAL,
    idempotencyKey: `${input.idempotencyKey}:withdraw-debit`,
    referenceId: created.id,
    metadata: {
      provider: CASHIER_PROVIDER,
      payoutAsset: method.asset,
      payoutNetwork: method.network
    }
  });

  await prisma.withdrawal.update({
    where: { id: created.id },
    data: {
      status: WithdrawalStatus.APPROVED,
      reviewedAt: new Date(),
      debitTransactionId: debit.entry.id
    }
  });

  const payoutCallbackUrl = `${env.OXAPAY_CALLBACK_BASE_URL!.replace(/\/+$/, "")}/api/v1/cashier/webhooks/oxapay/payout`;
  try {
    const payout = await createOxaPayPayout({
      method,
      destinationAddress: input.destinationAddress,
      amountAsset: quote.amountAsset,
      callbackUrl: payoutCallbackUrl,
      description: `withdrawal:${created.id}`
    });

    const broadcasted = await prisma.withdrawal.update({
      where: { id: created.id },
      data: {
        providerTrackId: payout.trackId,
        status: WithdrawalStatus.BROADCASTED,
        broadcastedAt: new Date(),
        metadata: {
          ...(created.metadata as Prisma.JsonObject | null),
          providerStatus: payout.status
        }
      }
    });

    return {
      id: broadcasted.id,
      status: broadcasted.status,
      amountAtomic: broadcasted.amountAtomic.toString(),
      asset: broadcasted.asset ?? method.asset,
      network: broadcasted.network,
      destinationAddress: broadcasted.destinationAddress,
      providerTrackId: broadcasted.providerTrackId
    };
  } catch (error) {
    await adjustWalletBalance({
      actorUserId: input.userId,
      userId: input.userId,
      currency: PLATFORM_INTERNAL_CURRENCY,
      amountAtomic: coinsAtomic,
      reason: LedgerReason.WITHDRAWAL,
      idempotencyKey: `${input.idempotencyKey}:withdraw-revert`,
      referenceId: created.id,
      metadata: {
        provider: CASHIER_PROVIDER,
        revert: true
      }
    });
    await prisma.withdrawal.update({
      where: { id: created.id },
      data: {
        status: WithdrawalStatus.FAILED,
        failedAt: new Date(),
        metadata: {
          ...(created.metadata as Prisma.JsonObject | null),
          providerFailureReason: error instanceof Error ? error.message : "Unknown payout error"
        }
      }
    });
    throw new AppError(
      error instanceof Error ? error.message : "Unable to create payout request",
      502,
      "CASHIER_PROVIDER_ERROR"
    );
  }
};

export const validatePaymentWebhookOrThrow = (
  rawBody: string | Buffer,
  receivedHmac: string | undefined
): void => {
  if (!verifyOxaPayWebhookHmac(rawBody, receivedHmac, env.OXAPAY_MERCHANT_API_KEY)) {
    throw new AppError("Invalid OxaPay payment webhook signature", 401, "OXAPAY_WEBHOOK_INVALID_SIGNATURE");
  }
};

export const validatePayoutWebhookOrThrow = (
  rawBody: string | Buffer,
  receivedHmac: string | undefined
): void => {
  if (!verifyOxaPayWebhookHmac(rawBody, receivedHmac, env.OXAPAY_PAYOUT_API_KEY)) {
    throw new AppError("Invalid OxaPay payout webhook signature", 401, "OXAPAY_WEBHOOK_INVALID_SIGNATURE");
  }
};

const computeDepositCreditCoinsAtomic = async (
  payload: OxaPayPaymentWebhookPayload,
  tx: OxaPayPaymentWebhookTx | undefined,
  fallbackAsset: CashierAsset
): Promise<bigint> => {
  const autoConverted = Number(tx?.auto_convert_amount ?? 0);
  if (Number.isFinite(autoConverted) && autoConverted > 0) {
    return toCoinsAtomicFromDecimal(autoConverted);
  }

  const rawAsset = String(tx?.currency ?? payload.currency ?? fallbackAsset).toUpperCase() as CashierAsset;
  const asset = (Object.keys(ASSET_DECIMALS) as CashierAsset[]).includes(rawAsset) ? rawAsset : fallbackAsset;
  const assetAmount = Number(tx?.sent_amount ?? payload.amount ?? tx?.value ?? payload.value ?? 0);
  if (!Number.isFinite(assetAmount) || assetAmount <= 0) {
    return 0n;
  }

  const assetAtomic = toAssetAtomic(assetAmount, ASSET_DECIMALS[asset]);
  if (assetAtomic <= 0n) {
    return 0n;
  }
  const quote = await quoteDepositToCoins(asset, assetAtomic);
  return quote.coinsAtomic;
};

export const processPaymentWebhook = async (payload: OxaPayPaymentWebhookPayload): Promise<void> => {
  if (!isCashierEnabled()) {
    return;
  }

  const trackId = String(payload.track_id ?? "").trim();
  if (!trackId) {
    return;
  }

  const paymentAddress = await prisma.paymentAddress.findUnique({
    where: {
      providerTrackId: trackId
    }
  });
  if (!paymentAddress) {
    return;
  }

  const wallet = await getUsdtWalletOrThrow(paymentAddress.userId);
  const tx = payload.txs?.[0];
  const txHash = tx?.tx_hash?.trim() || null;
  const fingerprint = callbackFingerprint(payload);
  const idempotencyKey = txHash
    ? `oxapay:deposit:${trackId}:${txHash}`
    : `oxapay:deposit:${trackId}:${payload.date ?? "0"}:${fingerprint}`;
  const status = (payload.status ?? "").trim().toLowerCase();
  const coinsAtomic = await computeDepositCreditCoinsAtomic(
    payload,
    tx,
    paymentAddress.asset as CashierAsset
  );
  if (coinsAtomic <= 0n) {
    return;
  }

  let deposit = await prisma.deposit.findFirst({
    where: {
      walletId: wallet.id,
      idempotencyKey
    }
  });
  if (!deposit) {
    deposit = await prisma.deposit.create({
      data: {
        userId: paymentAddress.userId,
        walletId: wallet.id,
        currency: PLATFORM_INTERNAL_CURRENCY,
        asset: paymentAddress.asset,
        network: paymentAddress.network,
        amountAtomic: coinsAtomic,
        txHash,
        sourceAddress: tx?.sender_address?.trim() || null,
        providerTrackId: trackId,
        status: status === "paid" ? DepositStatus.CONFIRMING : DepositStatus.PENDING,
        confirmations: tx?.confirmations ?? 0,
        requiredConfirmations: Math.max(1, tx?.confirmations ?? 1),
        idempotencyKey,
        metadata: {
          provider: CASHIER_PROVIDER,
          callbackFingerprint: fingerprint,
          raw: payload as unknown as Prisma.InputJsonValue
        }
      }
    });
  } else {
    deposit = await prisma.deposit.update({
      where: { id: deposit.id },
      data: {
        status: status === "paying" ? DepositStatus.CONFIRMING : deposit.status,
        confirmations: tx?.confirmations ?? deposit.confirmations,
        txHash: txHash ?? deposit.txHash,
        sourceAddress: tx?.sender_address?.trim() || deposit.sourceAddress,
        metadata: {
          ...(typeof deposit.metadata === "object" && deposit.metadata ? (deposit.metadata as Prisma.JsonObject) : {}),
          callbackFingerprint: fingerprint,
          raw: payload as unknown as Prisma.InputJsonValue
        }
      }
    });
  }

  if (status !== "paid" || deposit.creditedTransactionId) {
    return;
  }

  const credited = await adjustWalletBalance({
    actorUserId: deposit.userId,
    userId: deposit.userId,
    currency: PLATFORM_INTERNAL_CURRENCY,
    amountAtomic: deposit.amountAtomic,
    reason: LedgerReason.DEPOSIT,
    idempotencyKey: `${idempotencyKey}:credit`,
    referenceId: deposit.id,
    metadata: {
      provider: CASHIER_PROVIDER,
      providerTrackId: trackId,
      sourceAsset: deposit.asset,
      sourceNetwork: deposit.network,
      sourceTxHash: txHash
    }
  });

  await prisma.deposit.update({
    where: { id: deposit.id },
    data: {
      status: DepositStatus.COMPLETED,
      confirmedAt: new Date(),
      completedAt: new Date(),
      creditedTransactionId: credited.entry.id
    }
  });
  void applyReferralDepositBonusBestEffort(deposit.id, deposit.userId, deposit.amountAtomic);
};

export const processPayoutWebhook = async (payload: OxaPayPayoutWebhookPayload): Promise<void> => {
  if (!isCashierEnabled()) {
    return;
  }

  const trackId = String(payload.track_id ?? "").trim();
  if (!trackId) {
    return;
  }

  const withdrawal = await prisma.withdrawal.findFirst({
    where: {
      providerTrackId: trackId
    }
  });
  if (!withdrawal) {
    return;
  }

  const statusRaw = (payload.status ?? "").trim().toLowerCase();
  const mappedStatus =
    statusRaw === "confirmed"
      ? WithdrawalStatus.COMPLETED
      : statusRaw === "confirming"
        ? WithdrawalStatus.CONFIRMING
        : statusRaw === "failed"
          ? WithdrawalStatus.FAILED
          : WithdrawalStatus.BROADCASTED;
  const now = new Date();

  await prisma.withdrawal.update({
    where: { id: withdrawal.id },
    data: {
      status: mappedStatus,
      txHash: payload.tx_hash?.trim() || withdrawal.txHash,
      broadcastedAt:
        mappedStatus === WithdrawalStatus.BROADCASTED || mappedStatus === WithdrawalStatus.CONFIRMING
          ? withdrawal.broadcastedAt ?? now
          : withdrawal.broadcastedAt,
      completedAt: mappedStatus === WithdrawalStatus.COMPLETED ? now : withdrawal.completedAt,
      failedAt: mappedStatus === WithdrawalStatus.FAILED ? now : withdrawal.failedAt,
      metadata: {
        ...(typeof withdrawal.metadata === "object" && withdrawal.metadata ? (withdrawal.metadata as Prisma.JsonObject) : {}),
        providerStatus: payload.status ?? null,
        latestPayoutCallback: payload as unknown as Prisma.InputJsonValue
      }
    }
  });
};

