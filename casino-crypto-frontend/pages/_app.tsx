import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import AuthGate from "@/components/AuthGate";
import { getAccessToken } from "@/lib/api";

export default function App({ Component, pageProps }: AppProps) {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    if (getAccessToken()) setAuthed(true);
  }, []);

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
