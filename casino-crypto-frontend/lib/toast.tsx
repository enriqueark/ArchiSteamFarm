import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type ToastVariant = "error" | "success";

type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
};

export const APP_TOAST_EVENT = "app:toast";

export type AppToastEventDetail = {
  message: string;
  variant: ToastVariant;
};

const DOM_TOAST_CONTAINER_ID = "app-dom-toast-container";

const ensureDomToastContainer = (): HTMLElement | null => {
  if (typeof document === "undefined") {
    return null;
  }
  let container = document.getElementById(DOM_TOAST_CONTAINER_ID);
  if (!container) {
    container = document.createElement("div");
    container.id = DOM_TOAST_CONTAINER_ID;
    container.style.position = "fixed";
    container.style.top = "80px";
    container.style.left = "50%";
    container.style.transform = "translateX(-50%)";
    container.style.width = "min(640px, calc(100vw - 32px))";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.zIndex = "99999";
    container.style.pointerEvents = "none";
    document.body.appendChild(container);
  }
  return container;
};

const showDomToast = (detail: AppToastEventDetail): void => {
  const container = ensureDomToastContainer();
  if (!container || !detail.message.trim()) {
    return;
  }

  const item = document.createElement("div");
  item.textContent = detail.message;
  item.style.border = detail.variant === "error" ? "1px solid rgba(127,29,29,0.95)" : "1px solid rgba(20,83,45,0.95)";
  item.style.background = detail.variant === "error" ? "rgba(220,38,38,0.95)" : "rgba(22,163,74,0.95)";
  item.style.color = "#ffffff";
  item.style.padding = "12px 16px";
  item.style.borderRadius = "8px";
  item.style.fontWeight = "700";
  item.style.fontSize = "14px";
  item.style.boxShadow = "0 10px 24px rgba(0,0,0,0.35)";
  item.style.opacity = "0";
  item.style.transition = "opacity 180ms ease";

  container.appendChild(item);
  requestAnimationFrame(() => {
    item.style.opacity = "1";
  });

  setTimeout(() => {
    item.style.opacity = "0";
    setTimeout(() => {
      item.remove();
    }, 220);
  }, 5_000);
};

export const emitAppToast = (detail: AppToastEventDetail): void => {
  if (typeof window === "undefined") {
    return;
  }
  showDomToast(detail);
  window.dispatchEvent(new CustomEvent<AppToastEventDetail>(APP_TOAST_EVENT, { detail }));
};

const TOAST_DURATION_MS = 5_000;

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (message: string, variant: ToastVariant) => {
      if (!message.trim()) {
        return;
      }
      const id = Date.now() + Math.floor(Math.random() * 10_000);
      setToasts((prev) => [...prev.slice(-3), { id, message, variant }]);
      setTimeout(() => dismiss(id), TOAST_DURATION_MS);
    },
    [dismiss]
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      showError: (message: string) => push(message, "error"),
      showSuccess: (message: string) => push(message, "success")
    }),
    [push]
  );

  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<AppToastEventDetail>).detail;
      if (!detail?.message || (detail.variant !== "error" && detail.variant !== "success")) {
        return;
      }
      push(detail.message, detail.variant);
    };
    window.addEventListener(APP_TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(APP_TOAST_EVENT, onToast);
    };
  }, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div className="pointer-events-none fixed left-1/2 top-20 z-[70] flex w-full max-w-xl -translate-x-1/2 flex-col gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-md border px-4 py-3 text-sm font-semibold text-white shadow-lg ${
              toast.variant === "error"
                ? "border-red-900/80 bg-red-600/95"
                : "border-green-900/80 bg-green-600/95"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return ctx;
};

