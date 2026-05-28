"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { APP_TOAST_EVENT_NAME, type AppToastDetail } from "@/lib/toast";

const DEFAULT_DURATION_MS = 5_000;
const CLOSE_ANIMATION_MS = 250;
const SUCCESS_ICON_SRC = "/assets/success-toast-dino.svg";

const AMOUNT_REGEX = /\d[\d.,]*\s*[A-Z]{2,10}/;

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

export default function AppToastHost() {
  const [toast, setToast] = useState<AppToastDetail | null>(null);
  const [visible, setVisible] = useState(false);
  const [progressWidth, setProgressWidth] = useState("100%");
  const [progressTransition, setProgressTransition] = useState("none");
  const hideTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const progressKickoffRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (progressKickoffRef.current !== null) {
      window.clearTimeout(progressKickoffRef.current);
      progressKickoffRef.current = null;
    }
  }, []);

  const hideToast = useCallback(() => {
    clearTimers();
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      setToast(null);
      setProgressTransition("none");
      setProgressWidth("100%");
      closeTimerRef.current = null;
    }, CLOSE_ANIMATION_MS);
  }, [clearTimers]);

  const showToast = useCallback(
    (detail: AppToastDetail) => {
      clearTimers();
      const durationMs =
        typeof detail.durationMs === "number" && Number.isFinite(detail.durationMs) && detail.durationMs >= 1_000
          ? Math.round(detail.durationMs)
          : DEFAULT_DURATION_MS;

      setToast(detail);
      setVisible(true);
      setProgressTransition("none");
      setProgressWidth("100%");

      progressKickoffRef.current = window.setTimeout(() => {
        setProgressTransition(`width ${durationMs}ms linear`);
        setProgressWidth("0%");
      }, 50);

      hideTimerRef.current = window.setTimeout(() => {
        hideToast();
      }, durationMs);
    },
    [clearTimers, hideToast]
  );

  useEffect(() => {
    const onToast = (event: Event) => {
      const custom = event as CustomEvent<AppToastDetail>;
      if (!custom.detail?.description) return;
      showToast(custom.detail);
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && toast) {
        hideToast();
      }
    };

    window.addEventListener(APP_TOAST_EVENT_NAME, onToast as EventListener);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener(APP_TOAST_EVENT_NAME, onToast as EventListener);
      window.removeEventListener("keydown", onEscape);
      clearTimers();
    };
  }, [clearTimers, hideToast, showToast, toast]);

  const accentColor = toast?.variant === "error" ? "#f75154" : "#55FF60";
  const title = useMemo(() => {
    if (toast?.title?.trim()) return toast.title.trim();
    if (toast?.variant === "error") return "Error";
    return "Operación exitosa";
  }, [toast?.title, toast?.variant]);
  const descriptionParts = useMemo(
    () => splitDescription(toast?.description ?? "", toast?.amountText),
    [toast?.description, toast?.amountText]
  );

  if (!toast) return null;

  return (
    <>
      <div
        style={{
          position: "fixed",
          bottom: 24,
          left: 24,
          zIndex: 99999,
          maxWidth: 355,
          width: "calc(100% - 48px)",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(25px)",
          transition: visible
            ? "all 0.4s cubic-bezier(0.32, 0.72, 0, 1)"
            : "all 0.25s ease",
          pointerEvents: visible ? "auto" : "none",
          boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.5)"
        }}
      >
        <div
          onClick={hideToast}
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
              height: 3,
              background: accentColor
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 3,
              background: accentColor
            }}
          />

          <div
            style={{
              flexShrink: 0,
              width: 44,
              height: 37,
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <img
              src={SUCCESS_ICON_SRC}
              alt=""
              width={44}
              height={37}
              style={toast.variant === "error" ? { filter: "hue-rotate(300deg) saturate(1.25)" } : undefined}
            />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontFamily: "Inter, system-ui, sans-serif",
                fontWeight: 700,
                fontSize: 15,
                color: "#ffffff",
                margin: "0 0 2px 0",
                lineHeight: 1.2
              }}
            >
              {title}
            </p>
            <p
              style={{
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: 13,
                color: "#94a3b8",
                lineHeight: 1.35,
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
              bottom: 3,
              left: 0,
              height: 2.5,
              background: accentColor,
              width: progressWidth,
              transition: progressTransition,
              zIndex: 10
            }}
          />
        </div>
      </div>
    </>
  );
}

