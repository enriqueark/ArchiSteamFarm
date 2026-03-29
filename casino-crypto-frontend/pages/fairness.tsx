import Card from "@/components/Card";
import Button from "@/components/Button";

const hashPreview = "a4d8e2f18b5de3e3e7f7be89f96cc5b67d48...";
const clientSeedPreview = "b4bccae3bd4b53fe0419c2";

const tabs = ["How it works", "Battles", "Jackpot", "Coinflip", "Deals", "Cases", "Mines", "Keno"];

export default function FairnessPage() {
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
                {hashPreview}
              </code>
              <Button variant="success" className="px-3 py-1.5 text-xs">
                Generate New
              </Button>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-200">Client Seed</h3>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-[320px] rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-cyan-200">
                {clientSeedPreview}
              </code>
              <Button variant="success" className="px-3 py-1.5 text-xs">
                Change
              </Button>
            </div>
          </section>
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
              <tr className="border-t border-gray-800">
                <td className="px-3 py-4 text-center text-gray-500" colSpan={5}>
                  No data found...
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
