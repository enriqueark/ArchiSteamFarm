import { useEffect, useMemo, useState } from "react";

import { getCaseDetails, getCases, getMe } from "@/lib/api";
import {
  CASE_CATEGORY_TAGS,
  applyManagedCasesToList,
  applyManagedDataToDetails,
  computeVolatilityFromItems,
  getManagedCaseForRemoteId,
  getManagedLocalCaseById,
  removeManagedCase,
  toFormItems,
  upsertManagedCase,
  type AdminCaseFormItem,
  type CaseCategoryTag,
  type CaseMarketplaceDetails,
  type CaseMarketplaceItem
} from "@/lib/caseAdminStore";
import { useToast } from "@/lib/toast";

type FormState = {
  id: string;
  remoteCaseId: string | null;
  title: string;
  slug: string;
  description: string;
  logoUrl: string;
  priceCoins: string;
  isActive: boolean;
  tags: CaseCategoryTag[];
  items: AdminCaseFormItem[];
};

const blankForm = (): FormState => ({
  id: "",
  remoteCaseId: null,
  title: "",
  slug: "",
  description: "",
  logoUrl: "",
  priceCoins: "0.00",
  isActive: true,
  tags: ["ALL"],
  items: []
});

const newItem = (): AdminCaseFormItem => ({
  id: `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  name: "",
  imageUrl: "",
  valueCoins: "0.00",
  dropRate: "0",
  sortOrder: 0,
  isActive: true
});

const toAtomic = (coins: string): string => String(Math.max(0, Math.round((Number(coins) || 0) * 1e8)));

const toCoins = (atomic: string): string => {
  const value = Number(atomic);
  if (!Number.isFinite(value)) return "0.00";
  return (value / 1e8).toFixed(2);
};

const tagLabel: Record<CaseCategoryTag, string> = {
  ALL: "All",
  ORIGINALS: "Originals",
  CS2: "CS2",
  KNIVES: "Knives",
  GLOVES: "Gloves",
  "1%": "1%",
  "5%": "5%",
  "10%": "10%",
  CREATOR: "Creator"
};

const volColorByTier: Record<"L" | "M" | "H" | "I", string> = {
  L: "#22c55e",
  M: "#eab308",
  H: "#f97316",
  I: "#ef4444"
};

export default function AdminCasesPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<CaseMarketplaceItem[]>([]);
  const [form, setForm] = useState<FormState>(() => blankForm());

  const reload = async () => {
    const remoteCases = await getCases();
    const merged = applyManagedCasesToList(remoteCases, { includeInvisible: true });
    merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    setRows(merged);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getMe(), reload()])
      .then(([me]) => {
        if (!cancelled) {
          setIsAdmin(me.role === "ADMIN");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.showError(error instanceof Error ? error.message : "Failed to load admin cases.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const editCase = async (item: CaseMarketplaceItem) => {
    try {
      let details: CaseMarketplaceDetails | null = null;
      if (item.source === "admin-local") {
        details = getManagedLocalCaseById(item.id);
      } else if (item.source === "admin-override") {
        details = getManagedCaseForRemoteId(item.id);
      }
      if (!details) {
        const remoteDetails = await getCaseDetails(item.id);
        details = applyManagedDataToDetails(remoteDetails);
      }
      if (!details) return;
      setForm({
        id: details.source === "admin-local" ? details.id : `override-${details.id}`,
        remoteCaseId: details.source === "admin-local" ? null : details.id,
        title: details.title,
        slug: details.slug,
        description: details.description || "",
        logoUrl: details.logoUrl || "",
        priceCoins: toCoins(details.priceAtomic),
        isActive: details.isActive,
        tags: details.tags,
        items: toFormItems(details.items)
      });
    } catch (error) {
      toast.showError(error instanceof Error ? error.message : "Failed to load case details.");
    }
  };

  const volatilityPreview = useMemo(
    () =>
      computeVolatilityFromItems(
        form.items.map((item) => ({
          valueAtomic: toAtomic(item.valueCoins),
          dropRate: item.dropRate,
          isActive: item.isActive
        }))
      ),
    [form.items]
  );

  const saveCase = async () => {
    if (!form.title.trim()) {
      toast.showError("Case name is required.");
      return;
    }
    if (!Number.isFinite(Number(form.priceCoins)) || Number(form.priceCoins) <= 0) {
      toast.showError("Price must be greater than 0.");
      return;
    }

    setSaving(true);
    try {
      upsertManagedCase({
        id: form.id || undefined,
        remoteCaseId: form.remoteCaseId,
        slug: form.slug,
        title: form.title,
        description: form.description,
        logoUrl: form.logoUrl,
        priceCoins: form.priceCoins,
        isActive: form.isActive,
        tags: form.tags,
        items: form.items
      });
      toast.showSuccess("Case saved in admin panel.");
      await reload();
      setForm(blankForm());
    } catch (error) {
      toast.showError(error instanceof Error ? error.message : "Failed to save case.");
    } finally {
      setSaving(false);
    }
  };

  const deleteOverrideOrLocal = async () => {
    if (!form.id) return;
    removeManagedCase(form.id);
    toast.showSuccess("Admin case override removed.");
    await reload();
    setForm(blankForm());
  };

  if (loading) {
    return <div className="rounded-[12px] border border-[#1f3450] bg-[#07131f] p-4 text-sm text-[#9db3cc]">Loading admin panel...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="rounded-[12px] border border-[#43202a] bg-[#1f0b11] p-4 text-sm text-[#ffb4bd]">
        Admin role required.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[12px] border border-[#1f3450] bg-[#07131f] p-4">
        <h1 className="text-xl font-bold text-white">Admin Cases Panel</h1>
        <p className="text-sm text-[#91a8c2]">
          Configure visibility, price, image, items and category tags. Newly created admin cases appear in Cases page.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-[12px] border border-[#1f3450] bg-[#07131f] p-4">
          <h2 className="mb-3 text-sm font-bold uppercase text-[#b9cae0]">Existing Cases</h2>
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between rounded-[10px] border border-[#1e344e] bg-[#0a1726] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{row.title}</p>
                  <p className="text-xs text-[#92a8c1]">
                    {toCoins(row.priceAtomic)} COINS • VOL {row.volatilityTier} ({row.volatilityIndex}) •{" "}
                    {row.isActive ? "Visible" : "Hidden"}
                  </p>
                  <p className="text-[11px] text-[#7f95ae]">Tags: {row.tags.map((tag) => tagLabel[tag]).join(", ")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void editCase(row);
                  }}
                  className="rounded-[8px] border border-[#35506f] bg-[#102034] px-3 py-1 text-xs font-semibold text-white"
                >
                  Edit
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[12px] border border-[#1f3450] bg-[#07131f] p-4">
          <h2 className="mb-3 text-sm font-bold uppercase text-[#b9cae0]">{form.id ? "Edit Case" : "Create Case"}</h2>
          <div className="space-y-2">
            <input
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Case name"
              className="h-[40px] w-full rounded-[8px] border border-[#24405e] bg-[#081321] px-3 text-sm text-white outline-none"
            />
            <input
              value={form.slug}
              onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
              placeholder="Slug (optional)"
              className="h-[40px] w-full rounded-[8px] border border-[#24405e] bg-[#081321] px-3 text-sm text-white outline-none"
            />
            <input
              value={form.logoUrl}
              onChange={(event) => setForm((prev) => ({ ...prev, logoUrl: event.target.value }))}
              placeholder="Image URL"
              className="h-[40px] w-full rounded-[8px] border border-[#24405e] bg-[#081321] px-3 text-sm text-white outline-none"
            />
            <input
              value={form.priceCoins}
              onChange={(event) => setForm((prev) => ({ ...prev, priceCoins: event.target.value }))}
              placeholder="Price in coins"
              className="h-[40px] w-full rounded-[8px] border border-[#24405e] bg-[#081321] px-3 text-sm text-white outline-none"
            />
            <textarea
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Description"
              rows={3}
              className="w-full rounded-[8px] border border-[#24405e] bg-[#081321] px-3 py-2 text-sm text-white outline-none"
            />

            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-[#9fb4cb]">Category tags</p>
              <div className="grid grid-cols-3 gap-2">
              {CASE_CATEGORY_TAGS.map((tag) => {
                const active = form.tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      setForm((prev) => {
                        const has = prev.tags.includes(tag);
                        const next = has ? prev.tags.filter((item) => item !== tag) : [...prev.tags, tag];
                        if (next.length === 0) next.push("ALL");
                        return { ...prev, tags: next as CaseCategoryTag[] };
                      });
                    }}
                    className={`rounded-[8px] border px-2 py-1.5 text-[11px] font-semibold ${
                      active
                        ? "border-[#f5c14f] bg-[#f5c14f]/10 text-[#ffd56f]"
                        : "border-[#22405f] bg-[#0b1b2c] text-[#9cb1c9]"
                    }`}
                  >
                    {tagLabel[tag]}
                  </button>
                );
              })}
              </div>
              <p className="mt-1 text-[11px] text-[#7f95ae]">
                Selected: {form.tags.map((tag) => tagLabel[tag]).join(", ")}
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm text-[#c4d4e5]">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
              />
              Visible in Cases page
            </label>

            <div className="rounded-[8px] border border-[#1f3450] bg-[#081321] p-2">
              <p className="text-xs font-semibold uppercase text-[#a4b8ce]">
                Volatility preview: {volatilityPreview.volatilityTier} ({volatilityPreview.volatilityIndex})
              </p>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {(["L", "M", "H", "I"] as const).map((tier) => {
                  const active = tier === volatilityPreview.volatilityTier;
                  return (
                    <span
                      key={tier}
                      className="h-[4px] rounded-full"
                      style={{
                        backgroundColor: volColorByTier[tier],
                        opacity: active ? 1 : 0.3,
                        boxShadow: active ? `0 0 8px ${volColorByTier[tier]}` : "none"
                      }}
                    />
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase text-[#b9cae0]">Items</p>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, items: [...prev.items, { ...newItem(), sortOrder: prev.items.length }] }))}
                  className="rounded-[8px] border border-[#35506f] bg-[#102034] px-2 py-1 text-[11px] font-semibold text-white"
                >
                  Add item
                </button>
              </div>
              {form.items.map((item, idx) => (
                <div key={item.id} className="rounded-[8px] border border-[#20364f] bg-[#0a1726] p-2">
                  <div className="grid grid-cols-1 gap-2">
                    <input
                      value={item.name}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          items: prev.items.map((entry) => (entry.id === item.id ? { ...entry, name: event.target.value } : entry))
                        }))
                      }
                      placeholder="Item name"
                      className="h-[34px] rounded-[6px] border border-[#27435f] bg-[#081321] px-2 text-xs text-white outline-none"
                    />
                    <input
                      value={item.imageUrl}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          items: prev.items.map((entry) => (entry.id === item.id ? { ...entry, imageUrl: event.target.value } : entry))
                        }))
                      }
                      placeholder="Item image URL"
                      className="h-[34px] rounded-[6px] border border-[#27435f] bg-[#081321] px-2 text-xs text-white outline-none"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={item.valueCoins}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            items: prev.items.map((entry) => (entry.id === item.id ? { ...entry, valueCoins: event.target.value } : entry))
                          }))
                        }
                        placeholder="Value coins"
                        className="h-[34px] rounded-[6px] border border-[#27435f] bg-[#081321] px-2 text-xs text-white outline-none"
                      />
                      <input
                        value={item.dropRate}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            items: prev.items.map((entry) => (entry.id === item.id ? { ...entry, dropRate: event.target.value } : entry))
                          }))
                        }
                        placeholder="Drop rate %"
                        className="h-[34px] rounded-[6px] border border-[#27435f] bg-[#081321] px-2 text-xs text-white outline-none"
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          items: prev.items.filter((entry) => entry.id !== item.id).map((entry, order) => ({ ...entry, sortOrder: order }))
                        }))
                      }
                      className="rounded-[6px] border border-[#5c2b35] bg-[#2a1118] px-2 py-1 text-[11px] font-semibold text-[#ff9da8]"
                    >
                      Remove #{idx + 1}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={() => void saveCase()}
                disabled={saving}
                className="rounded-[10px] border border-[#ef4f5d] bg-gradient-to-b from-[#ff5f67] to-[#d62933] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save case"}
              </button>
              <button
                type="button"
                onClick={() => setForm(blankForm())}
                className="rounded-[10px] border border-[#35506f] bg-[#102034] px-4 py-2 text-sm font-semibold text-white"
              >
                New case
              </button>
              {form.id ? (
                <button
                  type="button"
                  onClick={() => void deleteOverrideOrLocal()}
                  className="rounded-[10px] border border-[#5c2b35] bg-[#2a1118] px-4 py-2 text-sm font-semibold text-[#ff9da8]"
                >
                  Delete override/local case
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
