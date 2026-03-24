import { useEffect, useState } from "react";
import { login, register } from "@/lib/api";
import Button from "./Button";
import Input from "./Input";
import Card from "./Card";
import type { AuthModalMode } from "@/lib/auth-ui";

interface Props {
  onAuth: () => void;
  mode?: AuthModalMode;
  embedded?: boolean;
  isModal?: boolean;
  onModeChange?: (mode: AuthModalMode) => void;
  onClose?: () => void;
}

export default function AuthGate({
  onAuth,
  mode = "login",
  embedded = false,
  isModal = false,
  onModeChange,
  onClose
}: Props) {
  const [modeState, setModeState] = useState<"login" | "register">(mode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setModeState(mode);
  }, [mode]);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      if (modeState === "register") {
        await register(email, password);
      } else {
        await login(email, password);
      }
      onAuth();
      onClose?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Auth failed");
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <Card title={modeState === "login" ? "Login" : "Register"} className="w-full max-w-sm">
      <div className="flex flex-col gap-3">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com"
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="min 8 characters"
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <Button
          variant={modeState === "register" ? "danger" : "primary"}
          onClick={submit}
          disabled={loading}
        >
          {loading ? "..." : modeState === "login" ? "Login" : "Register"}
        </Button>
        <button
          className="text-sm text-gray-400 hover:text-gray-200"
          onClick={() => {
            const nextMode = modeState === "login" ? "register" : "login";
            setModeState(nextMode);
            onModeChange?.(nextMode);
          }}
        >
          {modeState === "login" ? "Need an account? Register" : "Have an account? Login"}
        </button>
      </div>
    </Card>
  );

  if (embedded) {
    return content;
  }

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
        <div className="relative w-full max-w-sm">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="absolute -top-3 -right-3 h-8 w-8 rounded-full bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white"
              aria-label="Close auth modal"
            >
              ×
            </button>
          )}
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      {content}
    </div>
  );
}
