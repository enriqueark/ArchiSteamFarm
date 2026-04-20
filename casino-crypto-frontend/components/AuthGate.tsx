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
    <div className="min-h-screen flex items-center justify-center bg-page">
      <div className="w-full max-w-[380px]">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <img src="/assets/7099b46c6cd5928db5dde5a0c11f93e0.svg" alt="logo" className="h-8" />
            <span className="text-2xl font-bold text-white" style={{ fontStyle: "italic" }}>REDWATER</span>
          </div>
          <p className="text-sm text-muted">Crypto Casino</p>
        </div>

        <div className="rounded-card bg-panel p-6 shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424]">
          <div className="flex mb-6 bg-[#161616] rounded-btn p-1">
            <button
              onClick={() => setMode("login")}
              className={`flex-1 py-2.5 text-sm font-medium rounded-[10px] transition-all ${
                mode === "login"
                  ? "bg-panel text-white shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424]"
                  : "text-muted hover:text-white"
              }`}
            >
              Sign in
            </button>
            <button
              onClick={() => setMode("register")}
              className={`flex-1 py-2.5 text-sm font-medium rounded-[10px] transition-all ${
                mode === "register"
                  ? "bg-panel text-white shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424]"
                  : "text-muted hover:text-white"
              }`}
            >
              Sign up
            </button>
          </div>

          <div className="space-y-4" onKeyDown={handleKeyDown}>
            <div>
              <label className="block text-xs text-muted mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full bg-[#161616] rounded-btn px-4 py-3 text-sm text-white placeholder-[#555] outline-none border border-[#252525] focus:border-accent-red/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="min 8 characters"
                className="w-full bg-[#161616] rounded-btn px-4 py-3 text-sm text-white placeholder-[#555] outline-none border border-[#252525] focus:border-accent-red/50 transition-colors"
              />
            </div>

            {error && (
              <div className="bg-[#2a1015] border border-[#5c1a20] rounded-btn px-3 py-2">
                <p className="text-accent-red text-xs">{error}</p>
              </div>
            )}

            <button
              onClick={submit}
              disabled={loading}
              className="w-full py-3 rounded-btn bg-gradient-to-r from-[#ac2e30] to-[#f75154] text-white text-sm font-semibold transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-[inset_0_1px_0_#f24f51,inset_0_-1px_0_#ff7476]"
            >
              {loading ? "..." : mode === "login" ? "Sign in" : "Sign up"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
