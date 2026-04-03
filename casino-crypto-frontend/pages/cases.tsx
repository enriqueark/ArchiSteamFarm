import { useEffect, useMemo, useState } from "react";

import Button from "@/components/Button";
import Card from "@/components/Card";
import {
  getCases,
  getCaseDetails,
  getMyCaseOpenings,
  openCase,
  type CaseDetails,
  type CaseListItem,
  type CaseOpeningResult
} from "@/lib/api";

const toCoins = (atomic: string): number => {
  const n = Number(atomic);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return n / 1e8;
};

const fmtCoins = (atomic: string): string =>
  toCoins(atomic).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

type TopTierRevealProps = {
  opening: CaseOpeningResult;
  onClose: () => void;
};

function TopTierReveal({ opening, onClose }: TopTierRevealProps) {
  const [phase, setPhase] = useState<"spin" | "reveal">("spin");
  const [ticker, setTicker] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setPhase("reveal"), 1800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (phase !== "spin") return;
    const interval = setInterval(() => setTicker((v) => v + 1), 120);
    return () => clearInterval(interval);
  }, [phase]);

  const spinItem = useMemo(() => {
    if (!opening.topTierItems.length) {
      return opening.item;
    }
    return opening.topTierItems[ticker % opening.topTierItems.length];
  }, [opening, ticker]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-indigo-500/30 bg-[#0f172a] p-5 shadow-2xl">
        <h3 className="text-xl font-bold text-white">Top 5% Pull!</h3>
        <p className="mt-1 text-sm text-indigo-200">
          Special reroll among the most valuable items in this case.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
          {opening.topTierItems.map((item) => {
            const highlighted = phase === "spin" ? item.id === spinItem.id : item.id === opening.item.id;
            return (
              <div
                key={item.id}
                className={`rounded border p-2 text-xs ${
                  highlighted
                    ? "border-yellow-400 bg-yellow-500/20 text-yellow-100"
                    : "border-slate-700 bg-slate-900 text-slate-300"
                }`}
              >
                <div className="font-semibold">{item.name}</div>
                <div className="opacity-80">{fmtCoins(item.valueAtomic)} COINS</div>
              </div>
            );
          })}
        </div>

        {phase === "reveal" ? (
          <div className="mt-4 rounded border border-emerald-500/40 bg-emerald-500/10 p-3">
            <p className="text-sm text-emerald-200">You won:</p>
            <p className="text-lg font-bold text-emerald-100">
              {opening.item.name} • {fmtCoins(opening.item.valueAtomic)} COINS
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-300">Rerolling...</p>
        )}

        <div className="mt-4 flex justify-end">
          <Button
            disabled={phase !== "reveal"}
            onClick={onClose}
            className="bg-indigo-600 hover:bg-indigo-500"
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function CasesPage() {
  const authed = true;
  const openAuth = (_mode: "login" | "register") => {
    // auth handled globally in this frontend branch
  };
  const showError = (message: string) => {
    // keep UX feedback without extra providers
    // eslint-disable-next-line no-alert
    window.alert(message);
  };
  const showSuccess = (message: string) => {
    // eslint-disable-next-line no-alert
    window.alert(message);
  };

  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [selectedCase, setSelectedCase] = useState<CaseDetails | null>(null);
  const [myOpenings, setMyOpenings] = useState<CaseOpeningResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [topTierModal, setTopTierModal] = useState<CaseOpeningResult | null>(null);

  const loadData = async () => {
    const rows = await getCases();
    setCases(rows);
    if (!rows.length) {
      setSelectedCase(null);
      setMyOpenings([]);
      return;
    }

    const firstId = selectedCase?.id ?? rows[0].id;
    const details = await getCaseDetails(firstId);
    setSelectedCase(details);
    if (authed) {
      const history = await getMyCaseOpenings(20);
      setMyOpenings(history);
    } else {
      setMyOpenings([]);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadData()
      .catch((error) => {
        if (!cancelled) {
          showError(error instanceof Error ? error.message : "Failed to load cases");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  const selectCase = async (caseId: string) => {
    try {
      const details = await getCaseDetails(caseId);
      setSelectedCase(details);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to load case");
    }
  };

  const handleOpen = async () => {
    if (!selectedCase || opening) {
      return;
    }
    if (!authed) {
      openAuth("login");
      return;
    }
    setOpening(true);
    try {
      const result = await openCase(selectedCase.id);
      showSuccess(`You won ${result.item.name} (${fmtCoins(result.item.valueAtomic)} COINS)`);
      const refreshed = await getMyCaseOpenings(20);
      setMyOpenings(refreshed);
      if (result.topTierEligible) {
        setTopTierModal(result);
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to open case");
    } finally {
      setOpening(false);
    }
  };

  if (loading) {
    return <Card title="Cases">Loading cases...</Card>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-white">Cases</h1>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {cases.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              void selectCase(c.id);
            }}
            className={`rounded-lg border p-3 text-left transition ${
              selectedCase?.id === c.id
                ? "border-indigo-400 bg-indigo-500/10"
                : "border-slate-700 bg-slate-900 hover:border-slate-500"
            }`}
          >
            <div className="text-sm font-semibold text-white">{c.title}</div>
            <div className="text-xs text-slate-300">{fmtCoins(c.priceAtomic)} COINS</div>
            <div className="text-[11px] text-slate-400">
              VOL {c.volatilityTier} ({c.volatilityIndex})
            </div>
          </button>
        ))}
      </div>

      {selectedCase ? (
        <Card title={selectedCase.title}>
          {selectedCase.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selectedCase.logoUrl}
              alt={selectedCase.title}
              className="mb-3 h-28 w-28 rounded border border-slate-700 object-cover"
            />
          ) : null}
          <p className="text-sm text-slate-300">{selectedCase.description || "No description."}</p>
          <p className="mt-2 text-sm text-slate-200">
            Price: <span className="font-semibold">{fmtCoins(selectedCase.priceAtomic)} COINS</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Volatility: {selectedCase.volatilityTier} ({selectedCase.volatilityIndex})
          </p>

          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {selectedCase.items.map((item) => (
              <div key={item.id} className="rounded border border-slate-700 bg-slate-900 p-2 text-sm">
                <div className="font-semibold text-white">{item.name}</div>
                <div className="text-slate-300">
                  {fmtCoins(item.valueAtomic)} COINS • {Number(item.dropRate).toFixed(2)}%
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <Button
              onClick={() => {
                void handleOpen();
              }}
              disabled={opening}
              className="bg-lime-500 text-black hover:bg-lime-400"
            >
              {opening ? "Opening..." : `Open for ${fmtCoins(selectedCase.priceAtomic)} COINS`}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card title="My recent openings">
        <div className="space-y-2">
          {myOpenings.length ? (
            myOpenings.map((row) => (
              <div key={row.openingId} className="rounded border border-slate-700 bg-slate-900 p-2 text-sm">
                <div className="font-semibold text-white">
                  {row.caseTitle} → {row.item.name}
                </div>
                <div className="text-slate-300">
                  Paid {fmtCoins(row.priceAtomic)} / Won {fmtCoins(row.payoutAtomic)} / Profit {fmtCoins(row.profitAtomic)}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-400">No openings yet.</p>
          )}
        </div>
      </Card>

      {topTierModal ? (
        <TopTierReveal
          opening={topTierModal}
          onClose={() => {
            setTopTierModal(null);
          }}
        />
      ) : null}
    </div>
  );
}

