import Head from "next/head";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useAuthUI } from "@/lib/auth-ui";

const FIGMA_MAIN_WIDTH = 1920;
const FALLBACK_MAIN_HEIGHT = 2191;

export default function HomePage() {
  const router = useRouter();
  const { openAuth, authed } = useAuthUI();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeHeight, setIframeHeight] = useState(FALLBACK_MAIN_HEIGHT);
  const [scale, setScale] = useState(1);
  const iframeHeightRef = useRef(FALLBACK_MAIN_HEIGHT);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (typeof window === "undefined" || event.origin !== window.location.origin) {
        return;
      }
      const payload = event.data as { type?: string; mode?: "login" | "register"; path?: string } | null;
      if (!payload || typeof payload !== "object") {
        return;
      }
      if (payload.type === "figma-main-auth") {
        openAuth(payload.mode === "register" ? "register" : "login");
        return;
      }
      if (payload.type === "figma-main-navigate" && typeof payload.path === "string" && payload.path.startsWith("/")) {
        void router.push(payload.path);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [openAuth, router]);

  const syncIframeMetrics = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }
    const doc = iframe.contentDocument;
    if (doc) {
      const measuredHeight = Math.max(
        FALLBACK_MAIN_HEIGHT,
        doc.body?.scrollHeight ?? 0,
        doc.documentElement?.scrollHeight ?? 0
      );
      if (measuredHeight > 0 && measuredHeight !== iframeHeightRef.current) {
        iframeHeightRef.current = measuredHeight;
        setIframeHeight(measuredHeight);
      }
    }
    iframe.contentWindow?.postMessage(
      {
        type: "figma-main-session-updated",
        authed
      },
      window.location.origin
    );
  }, [authed]);

  useEffect(() => {
    const updateScale = () => {
      const viewportWidth = window.innerWidth;
      const nextScale = Math.min(1, viewportWidth / FIGMA_MAIN_WIDTH);
      setScale(nextScale > 0 ? nextScale : 1);
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }
    const onLoad = () => {
      syncIframeMetrics();
    };
    iframe.addEventListener("load", onLoad);
    const timer = window.setInterval(syncIframeMetrics, 1200);
    return () => {
      iframe.removeEventListener("load", onLoad);
      window.clearInterval(timer);
    };
  }, [syncIframeMetrics]);

  return (
    <>
      <Head>
        <title>REDWATER</title>
      </Head>
      <div className="w-full bg-[#090909]">
        <div
          className="mx-auto relative"
          style={{
            width: `${FIGMA_MAIN_WIDTH * scale}px`,
            height: `${iframeHeight * scale}px`
          }}
        >
          <iframe
            ref={iframeRef}
            title="Figma main export"
            src="/figma-main/main-gl.html"
            allow="clipboard-read; clipboard-write"
            loading="eager"
            scrolling="no"
            style={{
              width: FIGMA_MAIN_WIDTH,
              height: iframeHeight,
              border: 0,
              transform: `scale(${scale})`,
              transformOrigin: "top left"
            }}
          />
        </div>
      </div>
    </>
  );
}
