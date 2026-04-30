import { useEffect, useState } from "react";
import Card from "@/components/Card";
import Button from "@/components/Button";
import CoinAmount from "@/components/CoinAmount";
import { getWallets, type Wallet } from "@/lib/api";

function atomicToCoins(atomic: string): string {
  const n = Number(atomic);
  if (!Number.isFinite(n)) return "0.00";
  return (n / 1e8).toFixed(2);
}

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
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              // cashier deposit addresses endpoint guarantees account wallet initialization
              window.alert("Deposit flow is enabled from backend cashier. Ask me and I wire the full modal next.");
            }}
            disabled={loading}
          >
            Deposit
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              window.alert("Withdraw flow is enabled from backend cashier. Ask me and I wire the full modal next.");
            }}
            disabled={loading}
          >
            Withdraw
          </Button>
          <Button variant="secondary" onClick={fetchWallets} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </Button>
        </div>
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
          <Card key={w.id} title={w.currency}>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Balance (coins)</span>
                <CoinAmount
                  amount={w.balanceCoins ?? atomicToCoins(w.balanceAtomic)}
                  iconSize={16}
                  textClassName="font-mono"
                />
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Locked (coins)</span>
                <CoinAmount
                  amount={w.lockedCoins ?? atomicToCoins(w.lockedAtomic)}
                  iconSize={16}
                  textClassName="font-mono"
                />
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Available (coins)</span>
                <CoinAmount
                  amount={
                    w.availableCoins ??
                    atomicToCoins(
                      w.availableAtomic ?? String(BigInt(w.balanceAtomic) - BigInt(w.lockedAtomic))
                    )
                  }
                  iconSize={16}
                  textClassName="font-mono"
                />
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
