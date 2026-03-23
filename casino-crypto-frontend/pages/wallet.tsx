import { useEffect, useState } from "react";
import Card from "@/components/Card";
import Button from "@/components/Button";
import { getWallets, type Wallet } from "@/lib/api";

const VIRTUAL_CURRENCY_LABEL = "COINS";
const COIN_DECIMALS = 8;

const atomicToCoins = (atomic: string): string => {
  const value = Number(atomic);
  if (!Number.isFinite(value)) {
    return "0.00";
  }
  return (value / 10 ** COIN_DECIMALS).toFixed(2);
};

export default function WalletPage() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWallets = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getWallets();
      setWallets(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch wallets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWallets();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Wallets</h1>
        <Button variant="secondary" onClick={fetchWallets} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </Button>
      </div>

      {error && (
        <Card>
          <p className="text-red-400">{error}</p>
        </Card>
      )}

      {wallets.length === 0 && !loading && !error && (
        <Card>
          <p className="text-gray-500">No wallets found.</p>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {wallets.map((w) => (
          <Card key={w.id} title={VIRTUAL_CURRENCY_LABEL}>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Balance ({VIRTUAL_CURRENCY_LABEL})</span>
                <span className="font-mono">{atomicToCoins(w.balanceAtomic)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Locked ({VIRTUAL_CURRENCY_LABEL})</span>
                <span className="font-mono">{atomicToCoins(w.lockedAtomic)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">ID</span>
                <span className="font-mono text-xs text-gray-500">{w.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Updated</span>
                <span className="text-xs text-gray-500">
                  {new Date(w.updatedAt).toLocaleString()}
                </span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
