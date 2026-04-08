import { useState } from "react";
import Button from "@/components/Button";
import Card from "@/components/Card";
import { createWithdrawal } from "@/lib/api";

type WithdrawMethod = { asset: "USDT"; network: "erc20" };

const METHODS: WithdrawMethod[] = [
  { asset: "USDT", network: "erc20" }
];

export default function WithdrawPage() {
  const [coins, setCoins] = useState("10");
  const [address, setAddress] = useState("");
  const [method, setMethod] = useState<WithdrawMethod>(METHODS[0]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    setMessage(null);
    const amountCoins = Number(coins);
    if (!Number.isFinite(amountCoins) || amountCoins <= 0) {
      setMessage("Enter a valid amount in COINS.");
      return;
    }
    if (!address.trim()) {
      setMessage("Enter destination address.");
      return;
    }

    setLoading(true);
    try {
      const response = await createWithdrawal({
        asset: method.asset,
        network: method.network,
        amountCoins: amountCoins.toFixed(2),
        destinationAddress: address.trim()
      });
      setMessage(`Withdrawal requested: ${response.status} (${response.id})`);
      setAddress("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">Withdraw</h1>
      <Card title="Request withdrawal">
        <div className="space-y-3">
          <div>
            <label className="text-sm text-gray-400">Amount (COINS)</label>
            <input
              value={coins}
              onChange={(e) => setCoins(e.target.value)}
              className="mt-1 w-full bg-[#161616] border border-[#252525] rounded-lg px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400">Asset / Network</label>
            <select
              value={`${method.asset}:${method.network}`}
              onChange={(e) => {
                const selected = METHODS.find((m) => `${m.asset}:${m.network}` === e.target.value);
                if (selected) setMethod(selected);
              }}
              className="mt-1 w-full bg-[#161616] border border-[#252525] rounded-lg px-3 py-2 text-white"
            >
              {METHODS.map((m) => (
                <option key={`${m.asset}:${m.network}`} value={`${m.asset}:${m.network}`}>
                  {m.asset} ({m.network}) · COINS only
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400">Destination address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-1 w-full bg-[#161616] border border-[#252525] rounded-lg px-3 py-2 text-white"
              placeholder="Paste your wallet address"
            />
          </div>
          <Button onClick={submit} disabled={loading}>
            {loading ? "Submitting..." : "Request withdrawal"}
          </Button>
          {message ? <p className="text-sm text-gray-300">{message}</p> : null}
        </div>
      </Card>
    </div>
  );
}
