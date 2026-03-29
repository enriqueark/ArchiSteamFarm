import { useEffect, useState } from "react";
import Card from "@/components/Card";
import Button from "@/components/Button";
import Input from "@/components/Input";
import {
  getFairnessState,
  rotateFairnessServerSeed,
  setFairnessClientSeed,
  type FairnessState
} from "@/lib/api";
import { useAuthUI } from "@/lib/auth-ui";
import { useToast } from "@/lib/toast";

const tabs = ["How it works", "Battles", "Jackpot", "Coinflip", "Deals", "Cases", "Mines", "Keno"];

export default function FairnessPage() {
  const { authed, openAuth } = useAuthUI();
  const { showError, showSuccess } = useToast();
  const [state, setState] = useState<FairnessState | null>(null);
  const [loading, setLoading] = useState(true);
  const [clientSeedInput, setClientSeedInput] = useState("");
  const [savingClientSeed, setSavingClientSeed] = useState(false);
  const [rotating, setRotating] = useState(false);

  const loadFairness = async () => {
    const next = await getFairnessState();
    setState(next);
    setClientSeedInput(next.clientSeed);
  };

  useEffect(() => {
    if (!authed) {
      setState(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    loadFairness()
      .catch(() => {
        if (!cancelled) {
          setState(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authed]);

  const handleChangeClientSeed = async () => {
    if (!clientSeedInput.trim() || savingClientSeed) {
      return;
    }
    setSavingClientSeed(true);
    try {
      const updated = await setFairnessClientSeed(clientSeedInput.trim());
      setState((prev) =>
        prev
          ? {
              ...prev,
              clientSeed: updated.clientSeed,
              nonce: updated.nonce,
              activeServerSeedHash: updated.activeServerSeedHash
            }
          : prev
      );
      showSuccess("Client seed updated.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Could not update client seed");
    } finally {
      setSavingClientSeed(false);
    }
  };

  const handleRotate = async () => {
    if (rotating) {
      return;
    }
    setRotating(true);
    try {
      await rotateFairnessServerSeed();
      await loadFairness();
      showSuccess("Server seed rotated.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Could not rotate server seed");
    } finally {
      setRotating(false);
    }
  };

  if (!authed) {
    return (
      <Card title="Provably Fair">
        <p className="text-sm text-gray-300">Sign in to access fairness controls.</p>
        <button
          type="button"
          onClick={() => openAuth("login")}
          className="mt-3 rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Sign in
        </button>
      </Card>
    );
  }

  if (loading) {
    return <Card title="Provably Fair">Loading fairness state...</Card>;
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <h1 className="text-3xl font-bold text-white">Provably Fair</h1>
      <p className="text-xs text-gray-400">
        Provably Fair is a system that allows players to verify outcomes are generated honestly and not manipulated.
      </p>

      <Card>
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab, idx) => (
              <button
                key={tab}
                type="button"
                className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                  idx === 0
                    ? "border-indigo-500/40 bg-indigo-500/20 text-indigo-200"
                    : "border-gray-700 bg-gray-800/70 text-gray-300"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-white">What is Provably Fair?</h2>
            <p className="text-sm text-gray-300">
              Server seed is randomly generated before each game and hashed (SHA256) before gameplay. After the game,
              you can verify that this seed was not altered. Combined with your client seed and nonce, outcomes are
              deterministic and auditable.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-200">Server Seed Hash</h3>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-[320px] rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-cyan-200">
                {state?.activeServerSeedHash ?? "-"}
              </code>
              <Button
                variant="success"
                className="px-3 py-1.5 text-xs"
                disabled={rotating}
                onClick={() => {
                  void handleRotate();
                }}
              >
                {rotating ? "Generating..." : "Generate New"}
              </Button>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-200">Client Seed</h3>
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-[360px]">
                <Input value={clientSeedInput} onChange={(e) => setClientSeedInput(e.target.value)} />
              </div>
              <Button
                variant="success"
                className="px-3 py-1.5 text-xs"
                disabled={savingClientSeed}
                onClick={() => {
                  void handleChangeClientSeed();
                }}
              >
                {savingClientSeed ? "Changing..." : "Change"}
              </Button>
            </div>
          </section>
          <p className="text-xs text-gray-400">Current nonce: {state?.nonce ?? 0}</p>
        </div>
      </Card>

      <Card title="History">
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="min-w-full text-left text-xs text-gray-300">
            <thead className="bg-gray-900/70 text-[11px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Server seed</th>
                <th className="px-3 py-2">Hashed server seed</th>
                <th className="px-3 py-2">Client seed</th>
                <th className="px-3 py-2">Nonce</th>
              </tr>
            </thead>
            <tbody>
              {state?.revealedSeeds.length ? (
                state.revealedSeeds.map((seed) => (
                  <tr className="border-t border-gray-800" key={seed.id}>
                    <td className="px-3 py-2">{seed.id.slice(0, 8)}...</td>
                    <td className="px-3 py-2">{seed.serverSeed}</td>
                    <td className="px-3 py-2">{seed.serverSeedHash}</td>
                    <td className="px-3 py-2">{state.clientSeed}</td>
                    <td className="px-3 py-2">{state.nonce}</td>
                  </tr>
                ))
              ) : (
                <tr className="border-t border-gray-800">
                  <td className="px-3 py-4 text-center text-gray-500" colSpan={5}>
                    No data found...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
