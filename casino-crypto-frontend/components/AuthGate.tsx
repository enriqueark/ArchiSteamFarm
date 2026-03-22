import { useState } from "react";
import { login, register } from "@/lib/api";
import Button from "./Button";
import Input from "./Input";
import Card from "./Card";

interface Props {
  children: React.ReactNode;
  onAuth: () => void;
}

export default function AuthGate({ children, onAuth }: Props) {
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

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card title={mode === "login" ? "Login" : "Register"} className="w-full max-w-sm">
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
          <Button onClick={submit} disabled={loading}>
            {loading ? "..." : mode === "login" ? "Login" : "Register"}
          </Button>
          <button
            className="text-sm text-gray-400 hover:text-gray-200"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "Need an account? Register" : "Have an account? Login"}
          </button>
        </div>
      </Card>
    </div>
  );
}
