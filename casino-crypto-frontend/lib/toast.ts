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

export function emitAppToast(detail: AppToastDetail): void {
  if (typeof window === "undefined") {
    return;
  }
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

export function useToast() {
  return {
    showSuccess: showSuccessToast,
    showError: showErrorToast
  };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return children;
}
