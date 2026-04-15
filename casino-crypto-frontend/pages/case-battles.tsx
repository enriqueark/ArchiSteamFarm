import { useEffect, useMemo, useRef, useState } from "react";

import Button from "@/components/Button";
import Card from "@/components/Card";
import { requestLiveWinsRefresh } from "@/lib/liveWinsTicker";
import {
  callBattleBot,
  createBattle,
  fillBattleBots,
  getBattle,
  getCases,
  joinBattle,
  listBattles,
  type BattleState,
  type BattleTemplate,
  type CaseListItem
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

const TEMPLATES: Array<{ value: BattleTemplate; label: string }> = [
  { value: "ONE_VS_ONE", label: "1v1" },
  { value: "TWO_VS_TWO", label: "2v2" },
  { value: "ONE_VS_ONE_VS_ONE", label: "1v1v1" },
  { value: "ONE_VS_ONE_VS_ONE_VS_ONE", label: "1v1v1v1" },
  { value: "ONE_VS_ONE_VS_ONE_VS_ONE_VS_ONE_VS_ONE", label: "1v1v1v1v1v1" },
  { value: "TWO_VS_TWO_VS_TWO", label: "2v2v2" },
  { value: "THREE_VS_THREE", label: "3v3" }
];

const GROUP_COMPATIBLE = new Set<BattleTemplate>([
  "ONE_VS_ONE",
  "ONE_VS_ONE_VS_ONE",
  "ONE_VS_ONE_VS_ONE_VS_ONE",
  "ONE_VS_ONE_VS_ONE_VS_ONE_VS_ONE_VS_ONE"
]);

type CreateDraft = {
  template: BattleTemplate;
  modeCrazy: boolean;
  modeGroup: boolean;
  modeJackpot: boolean;
  modeTerminal: boolean;
  modePrivate: boolean;
  modeBorrow: boolean;
  borrowPercent: number;
  caseIds: string[];
};

type LobbyViewMode = "LOBBY" | "CREATOR";

const initialDraft: CreateDraft = {
  template: "ONE_VS_ONE",
  modeCrazy: false,
  modeGroup: false,
  modeJackpot: false,
  modeTerminal: false,
  modePrivate: false,
  modeBorrow: false,
  borrowPercent: 100,
  caseIds: []
};

const INTERNAL_CURRENCY = "USDT";

export default function BattlesPage() {
  const authed = true;
  const openAuth = (_mode: "login" | "register" = "login") => {};
  const showError = (message: string) => {
    if (typeof window !== "undefined") {
      window.alert(message);
    }
  };
  const showSuccess = (_message: string) => {};

  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [battles, setBattles] = useState<BattleState[]>([]);
  const [selectedBattleId, setSelectedBattleId] = useState<string | null>(null);
  const [selectedBattle, setSelectedBattle] = useState<BattleState | null>(null);
  const [draft, setDraft] = useState<CreateDraft>(initialDraft);
  const [viewMode, setViewMode] = useState<LobbyViewMode>("LOBBY");
  const [joinBorrowPercent, setJoinBorrowPercent] = useState(100);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [busySeat, setBusySeat] = useState<number | null>(null);
  const notifiedSettledBattleIdRef = useRef<string | null>(null);

  const battleCaseCostAtomic = useMemo(() => {
    const caseMap = new Map(cases.map((c) => [c.id, c]));
    let total = 0;
    for (const id of draft.caseIds) {
      const c = caseMap.get(id);
      if (!c) continue;
      total += Number(c.priceAtomic);
    }
    return total.toString();
  }, [cases, draft.caseIds]);

  const loadBattles = async () => {
    const rows = await listBattles({ includePrivate: false, limit: 40 });
    setBattles(rows);
    if (rows.length && !selectedBattleId) {
      setSelectedBattleId(rows[0].id);
    }
  };

  const loadAll = async () => {
    try {
      const casesRows = await getCases();
      setCases(casesRows);
    } catch (error) {
      setCases([]);
      showError(error instanceof Error ? error.message : "Failed to load cases");
    }

    if (!authed) {
      setBattles([]);
      setSelectedBattleId(null);
      setSelectedBattle(null);
      return;
    }

    try {
      await loadBattles();
    } catch (error) {
      setBattles([]);
      setSelectedBattleId(null);
      setSelectedBattle(null);
      showError(error instanceof Error ? error.message : "Failed to load battles");
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAll()
      .catch((error) => {
        if (!cancelled) {
          showError(error instanceof Error ? error.message : "Failed to load battles");
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

  useEffect(() => {
    if (!selectedBattleId) {
      setSelectedBattle(null);
      return;
    }
    let cancelled = false;
    getBattle(selectedBattleId)
      .then((row) => {
        if (!cancelled) {
          setSelectedBattle(row);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSelectedBattle(null);
          showError(error instanceof Error ? error.message : "Failed to load battle");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBattleId]);

  useEffect(() => {
    if (!selectedBattle || selectedBattle.status !== "SETTLED") return;
    if (notifiedSettledBattleIdRef.current === selectedBattle.id) return;
    notifiedSettledBattleIdRef.current = selectedBattle.id;
    requestLiveWinsRefresh();
  }, [selectedBattle]);

  const addCaseToDraft = (caseId: string) => {
    setDraft((prev) => {
      const next = [...prev.caseIds];
      if (next.length >= 50) {
        showError("Maximum 50 cases per battle");
        return prev;
      }
      next.push(caseId);
      return { ...prev, caseIds: next };
    });
  };

  const removeDraftCaseAt = (index: number) => {
    setDraft((prev) => {
      if (index < 0 || index >= prev.caseIds.length) {
        return prev;
      }
      const next = [...prev.caseIds];
      next.splice(index, 1);
      return { ...prev, caseIds: next };
    });
  };

  const handleCreate = async () => {
    if (!authed) {
      openAuth("login");
      return;
    }
    if (!draft.caseIds.length) {
      showError("Select at least one case");
      return;
    }
    if (draft.modeGroup && !GROUP_COMPATIBLE.has(draft.template)) {
      showError("Group mode only supports solo templates");
      return;
    }
    if (draft.modeGroup && draft.modeJackpot) {
      showError("Jackpot cannot be enabled in Group mode");
      return;
    }
    setCreating(true);
    try {
      const created = await createBattle({
        template: draft.template,
        caseIds: draft.caseIds,
        modeCrazy: draft.modeCrazy,
        modeGroup: draft.modeGroup,
        modeJackpot: draft.modeJackpot,
        modeTerminal: draft.modeTerminal,
        modePrivate: draft.modePrivate,
        modeBorrow: draft.modeBorrow,
        borrowPercent: draft.modeBorrow ? draft.borrowPercent : 100,
        currency: INTERNAL_CURRENCY
      });
      showSuccess("Battle created");
      await loadBattles();
      setSelectedBattleId(created.id);
      setViewMode("LOBBY");
      setDraft(initialDraft);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to create battle");
    } finally {
      setCreating(false);
    }
  };

  const refreshSelected = async () => {
    if (!selectedBattleId) return;
    const row = await getBattle(selectedBattleId);
    setSelectedBattle(row);
    await loadBattles();
  };

  const handleJoin = async () => {
    if (!selectedBattle) return;
    if (!authed) {
      openAuth("login");
      return;
    }
    setJoining(true);
    try {
      await joinBattle({
        battleId: selectedBattle.id,
        borrowPercent: selectedBattle.modeBorrow ? joinBorrowPercent : 100,
        currency: INTERNAL_CURRENCY
      });
      showSuccess("Joined battle");
      await refreshSelected();
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to join battle");
    } finally {
      setJoining(false);
    }
  };

  const handleCallBot = async (seatIndex: number) => {
    if (!selectedBattle) return;
    setBusySeat(seatIndex);
    try {
      await callBattleBot({
        battleId: selectedBattle.id,
        seatIndex,
        currency: INTERNAL_CURRENCY
      });
      showSuccess(`Bot called for seat #${seatIndex + 1}`);
      await refreshSelected();
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to call bot");
    } finally {
      setBusySeat(null);
    }
  };

  const handleFillBots = async () => {
    if (!selectedBattle) return;
    setBusySeat(-1);
    try {
      await fillBattleBots({
        battleId: selectedBattle.id,
        currency: INTERNAL_CURRENCY
      });
      showSuccess("Filled all open seats with bots");
      await refreshSelected();
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to fill bots");
    } finally {
      setBusySeat(null);
    }
  };

  if (loading) {
    return <Card title="Battles">Loading battles...</Card>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-white">Battles</h1>

      {viewMode === "LOBBY" ? (
        <Card title="Battles lobby">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-slate-300">Only active/pending battles are shown here.</p>
            <Button
              onClick={() => setViewMode("CREATOR")}
              className="bg-lime-500 text-black hover:bg-lime-400"
            >
              Create new battle
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {battles
              .filter((battle) => battle.status === "OPEN" || battle.status === "RUNNING")
              .map((battle) => (
                <button
                  key={battle.id}
                  type="button"
                  onClick={() => setSelectedBattleId(battle.id)}
                  className={`rounded border p-3 text-left ${
                    selectedBattleId === battle.id
                      ? "border-indigo-400 bg-indigo-500/10"
                      : "border-slate-700 bg-slate-900 hover:border-slate-500"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">{battle.template.replaceAll("_", " ")}</span>
                    <span className="text-xs text-slate-300">{battle.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-300">
                    Cost {fmtCoins(battle.totalCostAtomic)} • Cases {battle.cases.length}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {battle.modePrivate ? "Private" : "Public"} • {battle.modeGroup ? "Group" : "Winner takes"}
                  </div>
                </button>
              ))}
            {!battles.some((battle) => battle.status === "OPEN" || battle.status === "RUNNING") ? (
              <p className="text-sm text-slate-400">No active battles yet.</p>
            ) : null}
          </div>
        </Card>
      ) : (
        <Card title="Create battle">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-slate-300">Configure your battle and select up to 50 cases.</p>
            <Button
              variant="secondary"
              onClick={() => setViewMode("LOBBY")}
              className="px-3 py-1 text-xs"
            >
              Back to lobby
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-3 text-sm">
              <div>
                <label className="mb-1 block text-xs text-slate-300">Template</label>
                <select
                  value={draft.template}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      template: event.target.value as BattleTemplate
                    }))
                  }
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-white"
                >
                  {TEMPLATES.map((template) => (
                    <option key={template.value} value={template.value}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  ["modeCrazy", "Crazy"],
                  ["modeGroup", "Group"],
                  ["modeJackpot", "Jackpot"],
                  ["modeTerminal", "Terminal"],
                  ["modePrivate", "Private"],
                  ["modeBorrow", "Borrow"]
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-slate-200">
                    <input
                      type="checkbox"
                      checked={Boolean(draft[key as keyof CreateDraft])}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          [key]: event.target.checked
                        }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>

              {draft.modeBorrow ? (
                <div>
                  <label className="mb-1 block text-xs text-slate-300">Creator borrow % (20-100)</label>
                  <input
                    type="number"
                    min={20}
                    max={100}
                    value={draft.borrowPercent}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        borrowPercent: Math.max(20, Math.min(100, Math.trunc(Number(event.target.value) || 100)))
                      }))
                    }
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-white"
                  />
                </div>
              ) : null}

              <p className="text-xs text-slate-400">
                Selected: {draft.caseIds.length}/50 • Cost per player: {fmtCoins(battleCaseCostAtomic)} COINS
              </p>

              <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-slate-700 bg-slate-900 p-2">
                {draft.caseIds.map((caseId, idx) => {
                  const c = cases.find((item) => item.id === caseId);
                  if (!c) return null;
                  return (
                    <div key={`${caseId}-${idx}`} className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 px-2 py-1 text-xs">
                      <span className="text-slate-200">
                        #{idx + 1} {c.title} • {fmtCoins(c.priceAtomic)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeDraftCaseAt(idx)}
                        className="text-rose-300 hover:text-rose-200"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
                {!draft.caseIds.length ? <p className="text-xs text-slate-400">No cases selected yet.</p> : null}
              </div>

              <Button
                onClick={() => {
                  void handleCreate();
                }}
                disabled={creating}
                className="w-full bg-lime-500 text-black hover:bg-lime-400"
              >
                {creating ? "Creating..." : "Create battle"}
              </Button>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-white">Cases catalog</h3>
              <div className="max-h-[440px] space-y-1 overflow-y-auto rounded border border-slate-700 bg-slate-900 p-2">
                {cases.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => addCaseToDraft(c.id)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-left text-xs text-slate-200 hover:border-slate-500"
                  >
                    + {c.title} • {fmtCoins(c.priceAtomic)}
                  </button>
                ))}
                {!cases.length ? <p className="text-xs text-slate-400">No cases available.</p> : null}
              </div>
            </div>
          </div>
        </Card>
      )}

      {selectedBattle ? (
        <Card title={`Battle ${selectedBattle.id.slice(0, 10)}...`}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {[
                selectedBattle.modeCrazy ? "Crazy" : null,
                selectedBattle.modeGroup ? "Group" : null,
                selectedBattle.modeJackpot ? "Jackpot" : null,
                selectedBattle.modeTerminal ? "Terminal" : null,
                selectedBattle.modePrivate ? "Private" : null,
                selectedBattle.modeBorrow ? "Borrow" : null
              ]
                .filter(Boolean)
                .map((tag) => (
                  <span key={tag} className="rounded bg-slate-800 px-2 py-1 text-slate-200">
                    {tag}
                  </span>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {selectedBattle.slots.map((slot) => (
                <div key={slot.id} className="rounded border border-slate-700 bg-slate-900 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-300">
                      Seat #{slot.seatIndex + 1} • Team {slot.teamIndex + 1}
                    </span>
                    <span className="text-[11px] text-slate-400">{slot.state}</span>
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">{slot.displayName}</div>
                  <div className="mt-1 text-xs text-slate-300">
                    Paid {fmtCoins(slot.paidAmountAtomic)} • Payout {fmtCoins(slot.payoutAtomic)}
                  </div>
                  {selectedBattle.status === "OPEN" && slot.state === "OPEN" ? (
                    <Button
                      onClick={() => {
                        void handleCallBot(slot.seatIndex);
                      }}
                      disabled={busySeat !== null}
                      className="mt-2 w-full bg-indigo-600 hover:bg-indigo-500"
                    >
                      {busySeat === slot.seatIndex ? "Calling..." : "Call Bot"}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>

            {selectedBattle.status === "OPEN" ? (
              <div className="flex flex-wrap items-center gap-2">
                {selectedBattle.modeBorrow ? (
                  <input
                    type="number"
                    min={20}
                    max={100}
                    value={joinBorrowPercent}
                    onChange={(event) =>
                      setJoinBorrowPercent(Math.max(20, Math.min(100, Math.trunc(Number(event.target.value) || 100))))
                    }
                    className="w-36 rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white"
                  />
                ) : null}
                <Button
                  onClick={() => {
                    void handleJoin();
                  }}
                  disabled={joining}
                  className="bg-lime-500 text-black hover:bg-lime-400"
                >
                  {joining ? "Joining..." : "Join battle"}
                </Button>
                <Button
                  onClick={() => {
                    void handleFillBots();
                  }}
                  disabled={busySeat !== null}
                  className="bg-amber-500 text-black hover:bg-amber-400"
                >
                  {busySeat === -1 ? "Filling..." : "Fill Bots"}
                </Button>
              </div>
            ) : null}

            {selectedBattle.status === "SETTLED" ? (
              <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                Battle settled. Winner team:{" "}
                <span className="font-semibold">
                  {selectedBattle.winnerTeam !== null ? selectedBattle.winnerTeam + 1 : "N/A"}
                </span>
                {selectedBattle.modeJackpot && selectedBattle.jackpotRoll !== null ? (
                  <span> • Jackpot roll: {(selectedBattle.jackpotRoll * 100).toFixed(2)}%</span>
                ) : null}
              </div>
            ) : null}

            {selectedBattle.status === "SETTLED" && selectedBattle.modeJackpot && selectedBattle.jackpotChances?.length ? (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-white">Jackpot chances</h3>
                <div className="space-y-1 rounded border border-slate-700 bg-slate-900 p-2 text-xs">
                  {selectedBattle.jackpotChances
                    .slice()
                    .sort((a, b) => a.seatIndex - b.seatIndex)
                    .map((chance) => (
                      <div
                        key={chance.slotId}
                        className={`flex items-center justify-between rounded border px-2 py-1 ${
                          selectedBattle.jackpotWinnerSlotId === chance.slotId
                            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-100"
                            : "border-slate-800 bg-slate-950 text-slate-200"
                        }`}
                      >
                        <span>
                          Seat {chance.seatIndex + 1} • {chance.displayName}
                        </span>
                        <span className="font-semibold">{chance.chancePercent.toFixed(2)}%</span>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}

            <div>
              <h3 className="mb-2 text-sm font-semibold text-white">Cases order</h3>
              <div className="flex flex-wrap gap-2">
                {selectedBattle.cases.map((item) => (
                  <span key={item.id} className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200">
                    #{item.orderIndex + 1} {item.caseTitle}
                  </span>
                ))}
              </div>
            </div>

            {selectedBattle.drops.length ? (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-white">Drops</h3>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded border border-slate-700 bg-slate-900 p-2 text-xs">
                  {selectedBattle.drops.map((drop) => (
                    <div
                      key={drop.id}
                      className="flex items-center gap-2 rounded border border-slate-800 bg-slate-950 px-2 py-1 text-slate-200"
                    >
                      {drop.caseItemImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={drop.caseItemImageUrl}
                          alt={drop.caseItemName}
                          className="h-10 w-14 rounded border border-slate-700 bg-slate-900 object-contain"
                        />
                      ) : (
                        <div className="h-10 w-14 rounded border border-slate-800 bg-slate-900" />
                      )}
                      <div>
                        <div>
                          Round {drop.roundIndex + 1} • Seat {drop.orderIndex + 1} • {drop.caseItemName}
                        </div>
                        <div className="text-[11px] text-slate-300">{fmtCoins(drop.valueAtomic)} COINS</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
