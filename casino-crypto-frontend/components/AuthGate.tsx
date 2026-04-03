import { useState } from "react";
import { login, register } from "@/lib/api";

interface Props {
  onAuth: () => void;
}

export default function AuthGate({ onAuth }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      if (mode === "register") {
        await register(email, password);
      } else {
        await login(email, password);
      }
      onAuth();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Auth failed");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) submit();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight">
            <span className="text-brand">RED</span>
            <span className="text-white">WATER</span>
          </h1>
          <p className="text-gray-600 text-sm mt-1">Crypto Casino</p>
        </div>

        <div className="bg-surface-100 border border-border rounded-xl p-6">
          {/* Tabs */}
          <div className="flex gap-1 mb-6 bg-surface-200 rounded-lg p-1">
            <button
              onClick={() => setMode("login")}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                mode === "login"
                  ? "bg-surface-300 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Sign in
            </button>
            <button
              onClick={() => setMode("register")}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                mode === "register"
                  ? "bg-surface-300 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Sign up
            </button>
          </div>

          <div className="space-y-4" onKeyDown={handleKeyDown}>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full bg-surface-200 border border-border rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:border-brand/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="min 8 characters"
                className="w-full bg-surface-200 border border-border rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:border-brand/50 transition-colors"
              />
            </div>

            {error && (
              <div className="bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">
                <p className="text-red-400 text-xs">{error}</p>
              </div>
            )}

            <button
              onClick={submit}
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-brand hover:bg-brand-dark text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "..." : mode === "login" ? "Sign in" : "Sign up"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
