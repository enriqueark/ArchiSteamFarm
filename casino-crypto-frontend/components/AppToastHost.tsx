"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { APP_TOAST_EVENT_NAME, type AppToastDetail } from "@/lib/toast";

const DEFAULT_DURATION_MS = 5_000;
const CLOSE_ANIMATION_MS = 250;
const SUCCESS_ICON_SRC = "/assets/success-toast-dino.svg";
const ERROR_ICON_SRC = "/assets/error-toast-dino.svg";
const STACK_LIMIT = 4;

const AMOUNT_REGEX = /\d[\d.,]*\s*[A-Z]{2,10}/;

function toEnglishToast(detail: AppToastDetail): AppToastDetail {
  const titleMap: Record<string, string> = {
    "Operación exitosa": "Operation successful",
    "Tip exitoso": "Tip successful",
    "Tip Rain exitoso": "Rain tip successful",
    "Retiro exitoso": "Withdrawal successful",
    "Depósito exitoso": "Deposit successful",
    "Depósito fallido": "Deposit failed",
    "Retiro fallido": "Withdrawal failed"
  };

  const translateText = (value: string | undefined): string | undefined => {
    if (!value) return value;
    let next = value;
    next = titleMap[next] ?? next;
    next = next
      .replace(/^Tu depósito de (.+?) ha sido detectado y procesado exitosamente\.?$/i, "Your deposit of $1 has been detected and processed successfully.")
      .replace(/^Tu depósito de (.+?) no pudo ser procesado\.?$/i, "Your deposit of $1 could not be processed.")
      .replace(/^Tu retiro de (.+?) fue solicitado correctamente\.?$/i, "Your withdrawal of $1 was requested successfully.")
      .replace(/^Tu retiro de (.+?) no pudo ser procesado\.?$/i, "Your withdrawal of $1 could not be processed.")
      .replace(/^Has añadido (.+?) al Rain\.?$/i, "You added $1 to Rain.");
    return next;
  };

  return {
    ...detail,
    title: translateText(detail.title),
    description: translateText(detail.description) ?? detail.description
  };
}

function splitDescription(description: string, explicitAmount?: string): {
  before: string;
  amount: string | null;
  after: string;
} {
  const normalized = description ?? "";
  if (!normalized) {
    return { before: "", amount: null, after: "" };
  }

  const amountText = explicitAmount?.trim();
  if (amountText) {
    const index = normalized.indexOf(amountText);
    if (index >= 0) {
      return {
        before: normalized.slice(0, index),
        amount: amountText,
        after: normalized.slice(index + amountText.length)
      };
    }
  }

  const match = normalized.match(AMOUNT_REGEX);
  if (!match || typeof match.index !== "number") {
    return {
      before: normalized,
      amount: null,
      after: ""
    };
  }

  return {
    before: normalized.slice(0, match.index),
    amount: match[0],
    after: normalized.slice(match.index + match[0].length)
  };
}

type ToastItem = {
  id: string;
  detail: AppToastDetail;
  isClosing: boolean;
  progressActive: boolean;
};

type ToastVariantMetrics = {
  maxWidth: number;
  topBottomLineHeight: number;
  iconWidth: number;
  iconHeight: number;
  titleSize: number;
  titleMarginBottom: number;
  descriptionSize: number;
  descriptionLineHeight: number;
  progressBottom: number;
  progressHeight: number;
};

const ERROR_METRICS: ToastVariantMetrics = {
  maxWidth: 360,
  topBottomLineHeight: 3.5,
  iconWidth: 50,
  iconHeight: 42,
  titleSize: 15.5,
  titleMarginBottom: 3,
  descriptionSize: 13.2,
  descriptionLineHeight: 1.4,
  progressBottom: 3.5,
  progressHeight: 3
};

const SUCCESS_METRICS: ToastVariantMetrics = {
  maxWidth: 355,
  topBottomLineHeight: 3,
  iconWidth: 44,
  iconHeight: 37,
  titleSize: 15,
  titleMarginBottom: 2,
  descriptionSize: 13,
  descriptionLineHeight: 1.35,
  progressBottom: 3,
  progressHeight: 2.5
};

const getMetrics = (variant: AppToastDetail["variant"]): ToastVariantMetrics =>
  variant === "error" ? ERROR_METRICS : SUCCESS_METRICS;

const buildToastId = (): string => `toast-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export default function AppToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastsRef = useRef<ToastItem[]>([]);
  const hideTimersRef = useRef<Record<string, number>>({});
  const removeTimersRef = useRef<Record<string, number>>({});
  const progressTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);

  const clearToastTimers = useCallback((id: string) => {
    const hideTimer = hideTimersRef.current[id];
    if (typeof hideTimer === "number") {
      window.clearTimeout(hideTimer);
      delete hideTimersRef.current[id];
    }
    const removeTimer = removeTimersRef.current[id];
    if (typeof removeTimer === "number") {
      window.clearTimeout(removeTimer);
      delete removeTimersRef.current[id];
    }
    const progressTimer = progressTimersRef.current[id];
    if (typeof progressTimer === "number") {
      window.clearTimeout(progressTimer);
      delete progressTimersRef.current[id];
    }
  }, []);

  const clearAllTimers = useCallback(() => {
    Object.values(hideTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    Object.values(removeTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    Object.values(progressTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    hideTimersRef.current = {};
    removeTimersRef.current = {};
    progressTimersRef.current = {};
  }, []);

  const removeToast = useCallback(
    (id: string) => {
      clearToastTimers(id);
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    },
    [clearToastTimers]
  );

  const closeToast = useCallback(
    (id: string) => {
      setToasts((prev) =>
        prev.map((toast) =>
          toast.id === id
            ? {
                ...toast,
                isClosing: true
              }
            : toast
        )
      );
      clearToastTimers(id);
      removeTimersRef.current[id] = window.setTimeout(() => {
        removeToast(id);
      }, CLOSE_ANIMATION_MS);
    },
    [clearToastTimers, removeToast]
  );

  const scheduleToast = useCallback(
    (id: string) => {
      progressTimersRef.current[id] = window.setTimeout(() => {
        setToasts((prev) =>
          prev.map((toast) =>
            toast.id === id
              ? {
                  ...toast,
                  progressActive: true
                }
              : toast
          )
        );
      }, 50);

      hideTimersRef.current[id] = window.setTimeout(() => {
        closeToast(id);
      }, DEFAULT_DURATION_MS);
    },
    [closeToast]
  );

  const showToast = useCallback(
    (detail: AppToastDetail) => {
      if (!detail.description?.trim()) return;
      const normalizedDetail = toEnglishToast(detail);
      const nextId = buildToastId();

      setToasts((prev) => {
        let next = [...prev];
        if (next.length >= STACK_LIMIT) {
          const oldestToast = next[0];
          if (oldestToast) {
            clearToastTimers(oldestToast.id);
            next = next.slice(1);
          }
        }
        return [
          ...next,
          {
            id: nextId,
            detail: normalizedDetail,
            isClosing: false,
            progressActive: false
          }
        ];
      });

      scheduleToast(nextId);
    },
    [clearToastTimers, scheduleToast]
  );

  useEffect(() => {
    const onToastEvent = (event: Event) => {
      const custom = event as CustomEvent<AppToastDetail>;
      showToast(custom.detail);
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const latestToast = toastsRef.current[toastsRef.current.length - 1];
      if (latestToast) {
        closeToast(latestToast.id);
      }
    };

    window.addEventListener(APP_TOAST_EVENT_NAME, onToastEvent as EventListener);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener(APP_TOAST_EVENT_NAME, onToastEvent as EventListener);
      window.removeEventListener("keydown", onEscape);
      clearAllTimers();
    };
  }, [clearAllTimers, closeToast, showToast]);

  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "Unexpected error";
      if (!message) return;
      showToast({ variant: "error", description: message });
    };
    const onWindowError = (event: ErrorEvent) => {
      const message = event.message?.trim();
      if (!message || message === "Script error.") return;
      showToast({ variant: "error", description: message });
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onWindowError);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onWindowError);
    };
  }, [showToast]);

  if (!toasts.length) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: 24,
        zIndex: 99999,
        width: "calc(100% - 48px)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        pointerEvents: "none"
      }}
    >
      {toasts.map((toast) => {
        const isErrorToast = toast.detail.variant === "error";
        const variantMetrics = getMetrics(toast.detail.variant);
        const accentColor = isErrorToast ? "#f34950" : "#55FF60";
        const title = toast.detail.title?.trim() || (isErrorToast ? "Error" : "Operation successful");
        const descriptionParts = splitDescription(toast.detail.description ?? "", toast.detail.amountText);

        return (
          <div
            key={toast.id}
            style={{
              maxWidth: variantMetrics.maxWidth,
              width: "100%",
              opacity: toast.isClosing ? 0 : 1,
              transform: toast.isClosing ? "translateY(25px)" : "translateY(0)",
              transition: toast.isClosing
                ? "all 0.25s ease"
                : "all 0.4s cubic-bezier(0.32, 0.72, 0, 1)",
              boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.5)",
              pointerEvents: "auto"
            }}
          >
            <div
              onClick={() => closeToast(toast.id)}
              style={{
                background: "#0A0A0A",
                borderRadius: 9999,
                padding: "13px 18px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                position: "relative",
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: variantMetrics.topBottomLineHeight,
                  background: accentColor
                }}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: variantMetrics.topBottomLineHeight,
                  background: accentColor
                }}
              />

              <div
                style={{
                  flexShrink: 0,
                  width: variantMetrics.iconWidth,
                  height: variantMetrics.iconHeight,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                <img
                  src={isErrorToast ? ERROR_ICON_SRC : SUCCESS_ICON_SRC}
                  alt=""
                  width={variantMetrics.iconWidth}
                  height={variantMetrics.iconHeight}
                />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontFamily: "Inter, system-ui, sans-serif",
                    fontWeight: 700,
                    fontSize: variantMetrics.titleSize,
                    color: "#ffffff",
                    margin: `0 0 ${variantMetrics.titleMarginBottom}px 0`,
                    lineHeight: 1.2
                  }}
                >
                  {title}
                </p>
                <p
                  style={{
                    fontFamily: "Inter, system-ui, sans-serif",
                    fontSize: variantMetrics.descriptionSize,
                    color: "#94a3b8",
                    lineHeight: variantMetrics.descriptionLineHeight,
                    margin: 0
                  }}
                >
                  {descriptionParts.before}
                  {descriptionParts.amount ? (
                    <span style={{ color: "#ffffff", fontWeight: 600 }}>{descriptionParts.amount}</span>
                  ) : null}
                  {descriptionParts.after}
                </p>
              </div>

              <div
                style={{
                  position: "absolute",
                  bottom: variantMetrics.progressBottom,
                  left: 0,
                  height: variantMetrics.progressHeight,
                  background: accentColor,
                  width: toast.progressActive ? "0%" : "100%",
                  transition: toast.progressActive ? `width ${DEFAULT_DURATION_MS}ms linear` : "none",
                  zIndex: 10
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

