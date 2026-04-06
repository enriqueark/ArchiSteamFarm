import { useEffect, useState } from "react";
import Card from "@/components/Card";

declare global {
  interface Window {
    Intercom?: (...args: unknown[]) => void;
  }
}

export default function SupportPage() {
  const [status, setStatus] = useState("Opening live support...");

  useEffect(() => {
    let done = false;
    const run = () => {
      try {
        if (typeof window !== "undefined" && typeof window.Intercom === "function") {
          window.Intercom("show");
          window.Intercom("showMessages");
          setStatus("Live support opened.");
          done = true;
          return;
        }
      } catch {
        // fall through to fallback behavior below
      }

      // Placeholder for future provider. User still gets actionable feedback.
      if (!done) {
        setStatus("Live support will open here automatically when provider is connected.");
      }
    };

    run();
    const timeout = window.setTimeout(run, 600);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">Support</h1>
      <Card title="Live support chat">
        <p className="text-sm text-gray-300">
          {status}
        </p>
        <p className="mt-3 text-xs text-gray-500">
          As soon as live chat is fully integrated, this page opens the support widget directly.
        </p>
      </Card>
    </div>
  );
}
