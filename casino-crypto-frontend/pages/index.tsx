import Head from "next/head";
import { useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { useAuthUI } from "@/lib/auth-ui";

export default function HomePage() {
  const router = useRouter();
  const { openAuth, authed } = useAuthUI();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

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
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "figma-main-session-updated",
        authed
      },
      window.location.origin
    );
  }, [authed]);

  return (
    <>
      <Head>
        <title>REDWATER</title>
      </Head>
      <div className="h-[calc(100vh-98px)] w-full overflow-hidden rounded-none bg-[#090909]">
        <iframe
          ref={iframeRef}
          title="Figma main export"
          src="/figma-main/main-gl.html"
          className="h-full w-full border-0"
          allow="clipboard-read; clipboard-write"
          loading="eager"
        />
      </div>
    </>
  );
}
