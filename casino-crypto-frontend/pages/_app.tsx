import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import AuthGate from "@/components/AuthGate";
import { getAccessToken, validateSession } from "@/lib/api";

export default function App({ Component, pageProps }: AppProps) {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!getAccessToken()) {
      setChecking(false);
      return;
    }
    validateSession().then((valid) => {
      setAuthed(valid);
      setChecking(false);
    });
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        Verifying session...
      </div>
    );
  }

  return (
    <AuthGate onAuth={() => setAuthed(true)}>
      {authed && (
        <Layout>
          <Component {...pageProps} />
        </Layout>
      )}
    </AuthGate>
  );
}
