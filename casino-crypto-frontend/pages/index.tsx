import Head from "next/head";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useAuthUI } from "@/lib/auth-ui";

const FIGMA_MAIN_WIDTH = 1920;
const FIGMA_MAIN_HEIGHT = 2191;

export default function HomePage() {
  const router = useRouter();
  const { openAuth, authed } = useAuthUI();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [scale, setScale] = useState(1);

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

  useEffect(() => {
    const postSession = () => {
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "figma-main-session-updated",
          authed
        },
        window.location.origin
      );
    };
    postSession();
    const timer = window.setTimeout(postSession, 250);
    return () => window.clearTimeout(timer);
  }, [authed]);

  useEffect(() => {
    const updateScale = () => {
      const nextScale = Math.min(1, window.innerWidth / FIGMA_MAIN_WIDTH);
      setScale(nextScale > 0 ? nextScale : 1);
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  return (
    <>
      <Head>
        <title>REDWATER</title>
      </Head>
      <div className="w-full overflow-x-hidden bg-[#090909]">
        <div
          className="mx-auto relative"
          style={{
            width: `${Math.round(FIGMA_MAIN_WIDTH * scale)}px`,
            height: `${Math.round(FIGMA_MAIN_HEIGHT * scale)}px`
          }}
        >
          <iframe
            ref={iframeRef}
            title="Figma main export"
            src="/figma-main/main-gl.html"
            allow="clipboard-read; clipboard-write"
            loading="eager"
            style={{
              width: `${FIGMA_MAIN_WIDTH}px`,
              height: `${FIGMA_MAIN_HEIGHT}px`,
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
