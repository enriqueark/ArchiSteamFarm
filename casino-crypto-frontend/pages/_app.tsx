import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect, useState } from "react";
import GlobalChatDrawer from "@/components/GlobalChatDrawer";
import Layout from "@/components/Layout";
import AuthGate from "@/components/AuthGate";
import { getAccessToken, validateSession } from "@/lib/api";
import { AuthUIProvider, type AuthModalMode } from "@/lib/auth-ui";
import { ToastProvider } from "@/lib/toast";

export default function App({ Component, pageProps }: AppProps) {
  const [authed, setAuthed] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthModalMode>("login");

  useEffect(() => {
    let cancelled = false;
    if (!getAccessToken()) {
      setAuthed(false);
      return;
    }
    validateSession().then((valid) => {
      if (cancelled) {
        return;
      }
      setAuthed(valid);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openAuth = (mode: AuthModalMode = "login") => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  const closeAuth = () => {
    setAuthOpen(false);
  };

  const isHomeRoute = Component === (require("./index").default as AppProps["Component"]);

  return (
    <AuthUIProvider
      value={{
        authed,
        openAuth,
        closeAuth,
        setAuthed
      }}
    >
      <ToastProvider>
        <Layout>
          <Component {...pageProps} />
        </Layout>
        {!isHomeRoute && <GlobalChatDrawer />}
        {authOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <button
              aria-label="Close auth modal"
              className="absolute inset-0"
              onClick={closeAuth}
              type="button"
            />
            <div className="relative z-10 w-full flex items-center justify-center">
              <AuthGate
                key={authMode}
                onAuth={() => {
                  setAuthed(true);
                  closeAuth();
                }}
                mode={authMode}
                onClose={closeAuth}
                embedded
              />
            </div>
          </div>
        )}
      </ToastProvider>
    </AuthUIProvider>
  );
}
