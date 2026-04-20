import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import AuthGate from "@/components/AuthGate";
import { getAccessToken, validateSession, logout, getMe, clearSession, type User } from "@/lib/api";

export default function App({ Component, pageProps }: AppProps) {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!getAccessToken()) {
      setChecking(false);
      return;
    }
    validateSession().then((valid) => {
      setAuthed(valid);
      setChecking(false);
      if (valid) {
        getMe().then(setUser).catch(() => {});
      }
    });
  }, []);

  const handleLogout = async () => {
    try { await logout(); } catch { /* ignore */ }
    clearSession();
    setAuthed(false);
    setUser(null);
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  if (!authed) {
    return <AuthGate onAuth={() => {
      setAuthed(true);
      getMe().then(setUser).catch(() => {});
    }} />;
  }

  return (
    <Layout
      onLogout={handleLogout}
      userEmail={user?.username || user?.email}
      userLevel={user?.progression?.level ?? user?.level}
      userAvatarUrl={user?.avatarUrl ?? null}
      hideFooter={Component.name === "ProfilePage"}
    >
      <Component {...pageProps} />
    </Layout>
  );
}
