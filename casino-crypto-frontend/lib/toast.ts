import type { ReactNode } from "react";

export type ToastVariant = "success" | "error";

export type AppToastDetail = {
  message: string;
  variant: ToastVariant;
};

const EVENT_NAME = "app-toast";

export function emitAppToast(detail: AppToastDetail): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent<AppToastDetail>(EVENT_NAME, { detail }));
}

export function useToast() {
  return {
    showSuccess: (message: string) => emitAppToast({ message, variant: "success" }),
    showError: (message: string) => emitAppToast({ message, variant: "error" })
  };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return children;
}
