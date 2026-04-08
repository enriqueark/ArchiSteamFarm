import { useEffect, useState } from "react";
import Card from "@/components/Card";
import Button from "@/components/Button";
import { getDepositAddresses, type CashierAddress } from "@/lib/api";

export default function DepositPage() {
  const [addresses, setAddresses] = useState<CashierAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CashierAddress | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getDepositAddresses();
        if (!mounted) return;
        setAddresses(data.addresses || []);
        setSelected(data.addresses?.[0] ?? null);
      } catch (e: unknown) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load deposit addresses");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">Deposit</h1>
      <Card title="Add funds">
        {loading ? <p className="text-sm text-gray-400">Loading deposit addresses...</p> : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        {!loading && !error ? (
          <>
            <p className="text-sm text-gray-300 mb-4">Select network and send funds to your personal address.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {addresses.map((address) => {
                const active = selected?.providerTrackId === address.providerTrackId;
                return (
                  <button
                    key={address.providerTrackId}
                    type="button"
                    onClick={() => setSelected(address)}
                    className={`rounded-lg border transition-colors p-3 text-left ${
                      active
                        ? "border-red-500 bg-[#1a1212]"
                        : "border-[#2a2a2a] bg-[#121212] hover:bg-[#161616]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">
                        {address.asset} ({address.network.toUpperCase()})
                      </span>
                      <span className="text-[11px] text-gray-400">{address.networkLabel}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            {selected ? (
              <div className="mt-4 rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] p-3">
                <p className="text-xs text-gray-400 mb-1">Deposit address</p>
                <p className="text-sm text-white break-all font-mono">{selected.address}</p>
                <div className="mt-3 flex gap-2">
                  <Button
                    className="bg-[#2a2a2a] hover:bg-[#333]"
                    onClick={() => {
                      void navigator.clipboard.writeText(selected.address);
                    }}
                  >
                    Copy address
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 mt-4">No deposit address available.</p>
            )}
          </>
        ) : null}
      </Card>
    </div>
  );
}
