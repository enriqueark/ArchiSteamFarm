import { useEffect, useRef } from "react";
import {
  applyDepositBonusCode,
  createWithdrawal,
  getDepositAddresses,
  redeemPromoCode,
  type CashierWithdrawalAsset,
  type CashierWithdrawalNetwork
} from "@/lib/api";
import { useToast } from "@/lib/toast";

type Props = {
  open: boolean;
  onClose: () => void;
  onBalanceRefresh?: () => void;
};

type WalletBridgeRequest =
  | {
      type: "dinoskins-wallet-bridge";
      direction: "request";
      requestId: number;
      action: "getDepositAddresses";
      payload?: unknown;
    }
  | {
      type: "dinoskins-wallet-bridge";
      direction: "request";
      requestId: number;
      action: "createWithdrawal";
      payload: {
        asset: CashierWithdrawalAsset;
        network: CashierWithdrawalNetwork;
        amountCoins: string;
        destinationAddress: string;
      };
    }
  | {
      type: "dinoskins-wallet-bridge";
      direction: "request";
      requestId: number;
      action: "redeemPromoCode";
      payload: {
        code: string;
      };
    }
  | {
      type: "dinoskins-wallet-bridge";
      direction: "request";
      requestId: number;
      action: "applyDepositBonusCode";
      payload: {
        code: string;
      };
    };

type WalletBridgeEvent = {
  type: "dinoskins-wallet-bridge";
  direction: "event";
  name: "toast" | "close" | "refreshBalance";
  payload?: {
    variant?: "success" | "error";
    message?: string;
  };
};

const BRIDGE_TYPE = "dinoskins-wallet-bridge";

export default function CashierWalletModal({ open, onClose, onBalanceRefresh }: Props) {
  const toast = useToast();
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handleBridgeMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as WalletBridgeRequest | WalletBridgeEvent | undefined;
      if (!data || data.type !== BRIDGE_TYPE) return;

      if (data.direction === "event") {
        if (data.name === "close") {
          onClose();
          return;
        }
        if (data.name === "refreshBalance") {
          onBalanceRefresh?.();
          window.dispatchEvent(new Event("refreshBalance"));
          return;
        }
        if (data.name === "toast") {
          const message = data.payload?.message;
          if (!message) return;
          if (data.payload?.variant === "error") {
            toast.showError(message);
            return;
          }
          toast.showSuccess(message);
        }
        return;
      }

      if (data.direction !== "request") return;

      const source = event.source as Window | null;
      const reply = (ok: boolean, payload?: unknown, error?: string) => {
        source?.postMessage(
          {
            type: BRIDGE_TYPE,
            direction: "response",
            requestId: data.requestId,
            ok,
            payload,
            error
          },
          "*"
        );
      };

      const run = async () => {
        if (data.action === "getDepositAddresses") {
          const result = await getDepositAddresses();
          reply(true, result);
          return;
        }
        if (data.action === "createWithdrawal") {
          const payload = data.payload as
            | {
                asset?: CashierWithdrawalAsset;
                network?: CashierWithdrawalNetwork;
                amountCoins?: string;
                destinationAddress?: string;
              }
            | undefined;
          if (!payload || typeof payload !== "object") {
            throw new Error("Invalid withdrawal payload.");
          }
          if (!payload.asset || !payload.network || !payload.amountCoins || !payload.destinationAddress) {
            throw new Error("Incomplete withdrawal payload.");
          }
          const created = await createWithdrawal({
            asset: payload.asset,
            network: payload.network,
            amountCoins: payload.amountCoins,
            destinationAddress: payload.destinationAddress
          });
          onBalanceRefresh?.();
          window.dispatchEvent(new Event("refreshBalance"));
          reply(true, created);
          return;
        }
        if (data.action === "redeemPromoCode") {
          const payload = data.payload as { code?: string } | undefined;
          if (!payload || typeof payload.code !== "string") {
            throw new Error("Invalid promo code payload.");
          }
          const redeemed = await redeemPromoCode(payload.code);
          onBalanceRefresh?.();
          window.dispatchEvent(new Event("refreshBalance"));
          reply(true, redeemed);
          return;
        }
        if (data.action === "applyDepositBonusCode") {
          const payload = data.payload as { code?: string } | undefined;
          if (!payload || typeof payload.code !== "string") {
            throw new Error("Invalid bonus code payload.");
          }
          const applied = await applyDepositBonusCode(payload.code);
          reply(true, applied);
          return;
        }
        throw new Error("Unsupported wallet bridge action.");
      };

      void run().catch((error: unknown) => {
        const err = error as Error & { __appToastShown?: boolean };
        if (!err?.__appToastShown) {
          toast.showError(err instanceof Error ? err.message : "Wallet action failed.");
        }
        reply(false, undefined, err instanceof Error ? err.message : "Wallet action failed.");
      });
    };

    window.addEventListener("message", handleBridgeMessage);
    return () => {
      window.removeEventListener("message", handleBridgeMessage);
    };
  }, [onBalanceRefresh, onClose, open, toast]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center bg-[rgba(26,26,26,0.62)] p-3 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <iframe
        ref={frameRef}
        src="/dinoskins-wallet-v14-banner-no-gap.html?embedded=1"
        title="Dinoskins Wallet"
        className="h-full w-full border-0"
        style={{ background: "transparent" }}
      />
    </div>
  );
}
