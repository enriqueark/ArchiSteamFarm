import type { ReactNode } from "react";

export type ToastVariant = "success" | "error";

export type AppToastInput =
  | string
  | {
      title?: string;
      description: string;
      amountText?: string;
      durationMs?: number;
    };

export type AppToastDetail = {
  title?: string;
  description: string;
  amountText?: string;
  variant: ToastVariant;
  durationMs?: number;
};

export const APP_TOAST_EVENT_NAME = "app-toast";
let lastToastEmit: { variant: ToastVariant; description: string; at: number } | null = null;

export function emitAppToast(detail: AppToastDetail): void {
  if (typeof window === "undefined") {
    return;
  }
  const now = Date.now();
  const description = detail.description ?? "";
  if (
    lastToastEmit &&
    lastToastEmit.variant === detail.variant &&
    lastToastEmit.description === description &&
    now - lastToastEmit.at < 500
  ) {
    return;
  }
  lastToastEmit = {
    variant: detail.variant,
    description,
    at: now
  };
  window.dispatchEvent(new CustomEvent<AppToastDetail>(APP_TOAST_EVENT_NAME, { detail }));
}

const normalizeToastInput = (input: AppToastInput): Pick<AppToastDetail, "title" | "description" | "amountText" | "durationMs"> => {
  if (typeof input === "string") {
    return {
      description: input
    };
  }

  return {
    title: input.title,
    description: input.description,
    amountText: input.amountText,
    durationMs: input.durationMs
  };
};

export function showSuccessToast(input: AppToastInput): void {
  emitAppToast({
    ...normalizeToastInput(input),
    variant: "success"
  });
}

export function showErrorToast(input: AppToastInput): void {
  emitAppToast({
    ...normalizeToastInput(input),
    variant: "error"
  });
}

const TOAST_API = Object.freeze({
  showSuccess: showSuccessToast,
  showError: showErrorToast
});

export function useToast() {
  return TOAST_API;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return children;
}
