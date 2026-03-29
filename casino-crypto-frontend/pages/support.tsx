import { useMemo } from "react";
import Card from "@/components/Card";
import Button from "@/components/Button";
import { useToast } from "@/lib/toast";

declare global {
  interface Window {
    Intercom?: (...args: unknown[]) => void;
  }
}

export default function SupportPage() {
  const { showSuccess } = useToast();
  const hasIntercom = useMemo(
    () => typeof window !== "undefined" && typeof window.Intercom === "function",
    []
  );

  const openSupport = () => {
    if (typeof window !== "undefined" && typeof window.Intercom === "function") {
      window.Intercom("show");
      return;
    }
    showSuccess("Live support will be available soon (Intercom pending integration).");
  };

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-white">Support</h1>
      <p className="text-sm text-gray-400">
        Contact live support. This page is prepared for Intercom and will open chat as soon as Intercom is connected.
      </p>

      <Card className="border-gray-700/90 bg-gradient-to-br from-[#18243a] to-[#111a2b]">
        <div className="space-y-3">
          <h2 className="text-xl font-semibold text-white">Live Chat</h2>
          <p className="text-sm text-gray-300">
            {hasIntercom
              ? "Intercom detected. Click below to open support chat."
              : "Intercom is not configured yet in this environment. The button is ready and will activate automatically once integrated."}
          </p>
          <Button className="mt-1" onClick={openSupport}>
            Open Support Chat
          </Button>
        </div>
      </Card>
    </div>
  );
}

