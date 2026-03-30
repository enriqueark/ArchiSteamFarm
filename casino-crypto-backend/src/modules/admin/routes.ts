import {
  DepositStatus,
  LedgerDirection,
  LedgerReason,
  Prisma,
  UserRole,
  UserStatus,
  WithdrawalStatus
} from "@prisma/client";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireRoles } from "../../core/auth";
import { AppError } from "../../core/errors";
import { requireIdempotencyKey } from "../../core/idempotency";
import { prisma } from "../../infrastructure/db/prisma";
import { getBlackjackPayoutConfig, setBlackjackPayoutConfig } from "../blackjack/config";
import { adjustWalletBalance } from "../ledger/service";
import { getLevelFromXp } from "../progression/service";
import { PLATFORM_INTERNAL_CURRENCY, PLATFORM_VIRTUAL_COIN_SYMBOL } from "../wallets/service";

const userSearchQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
  all: z.coerce.boolean().default(true)
});

const userDetailParamsSchema = z.object({
  userId: z.string().cuid()
});

const userDetailQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

const updateUserStatusSchema = z.object({
  status: z.nativeEnum(UserStatus),
  role: z.nativeEnum(UserRole).optional()
});

const adjustByAdminSchema = z
  .object({
    userId: z.string().cuid().optional(),
    email: z.string().email().optional(),
    amountAtomic: z
      .string()
      .regex(/^-?\d+$/, "amountAtomic must be an integer string")
      .transform((value) => BigInt(value))
      .refine((value) => value !== 0n, "amountAtomic cannot be 0"),
    reason: z
      .nativeEnum(LedgerReason)
      .default(LedgerReason.ADMIN_ADJUSTMENT)
      .refine(
        (value) =>
          value !== LedgerReason.BET_HOLD &&
          value !== LedgerReason.BET_RELEASE &&
          value !== LedgerReason.BET_CAPTURE &&
          value !== LedgerReason.BET_PAYOUT,
        {
          message: "Reason is not allowed in this administrative endpoint"
        }
      ),
    referenceId: z.string().max(64).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .refine((value) => Boolean(value.userId) !== Boolean(value.email), {
    message: "Provide exactly one of userId or email",
    path: ["userId"]
  });

const isMissingLevelXpColumnError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
    return true;
  }
  if (error instanceof Error) {
    return error.message.toLowerCase().includes("levelxpatomic");
  }
  return false;
};

const ADMIN_PANEL_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Casino Admin Panel</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; background: #0b1220; color: #e5e7eb; }
      h1 { margin: 0 0 16px; }
      h2 { margin: 0 0 10px; font-size: 16px; }
      .card { background: #111827; border: 1px solid #1f2937; border-radius: 10px; padding: 14px; margin-bottom: 14px; }
      input, select, button, textarea { padding: 8px; border-radius: 8px; border: 1px solid #374151; background: #0f172a; color: #e5e7eb; }
      button { cursor: pointer; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border-bottom: 1px solid #1f2937; text-align: left; padding: 8px; vertical-align: top; }
      .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .ok { color: #22c55e; }
      .err { color: #ef4444; white-space: pre-wrap; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
      .muted { color: #94a3b8; }
      .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .pill { border: 1px solid #334155; border-radius: 999px; padding: 4px 10px; font-size: 12px; }
      .actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
      .danger { background: #7f1d1d; border-color: #991b1b; }
      .warn { background: #78350f; border-color: #92400e; }
      .success { background: #14532d; border-color: #166534; }
      .detail-table td { border-bottom: 1px solid #1e293b; }
    </style>
  </head>
  <body>
    <h1>Admin Panel</h1>

    <div class="card">
      <div class="row">
        <label>Admin email:</label>
        <input id="adminEmail" style="min-width:260px" placeholder="admin@domain.com" />
        <label>Password:</label>
        <input id="adminPassword" type="password" style="min-width:220px" placeholder="********" />
        <button id="loginBtn">Login as admin</button>
      </div>
      <div class="row" style="margin-top:10px;">
        <label>Access token:</label>
        <input id="token" style="min-width:520px" placeholder="Auto-filled after login (or paste manually)" />
        <button id="checkTokenBtn">Verify token</button>
        <button id="logoutBtn">Logout current token</button>
      </div>
      <div id="authStatus" class="mono"></div>
    </div>

    <div class="card">
      <div class="row">
        <label>Search user:</label>
        <input id="query" placeholder="email, uuid, or user #id..." />
        <label>Limit:</label>
        <input id="limit" type="number" min="1" max="5000" value="1000" style="width:100px" />
        <label style="display:flex;align-items:center;gap:6px;">
          <input id="allUsers" type="checkbox" checked />
          All users
        </label>
        <button id="searchBtn">Refresh users</button>
      </div>
      <div class="mono muted" style="margin-top:8px;">Balance adjust only uses ${PLATFORM_VIRTUAL_COIN_SYMBOL} (${PLATFORM_INTERNAL_CURRENCY})</div>
      <div id="searchStatus"></div>
      <table id="usersTable">
        <thead>
          <tr><th>User / Progression</th><th>Wallets</th><th>Actions</th></tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>

    <div id="detailCard" class="card" style="display:none;">
      <h2>User profile details</h2>
      <div id="detailStatus" class="mono"></div>
      <div id="detailContent"></div>
    </div>

    <div class="card">
      <h2>Cases Manager (CS2)</h2>
      <div class="row">
        <label>Import pages:</label>
        <input id="casesImportPages" type="number" min="1" max="20" value="6" style="width:90px" />
        <button id="casesImportBtn">Import from Rain</button>
        <input id="casesSkinSearch" placeholder="Search skin name..." style="min-width:220px" />
        <button id="casesSearchSkinsBtn">Search skins</button>
      </div>
      <div id="casesStatus" class="mono" style="margin-top:8px;"></div>
      <div class="mono muted" style="margin-top:4px;">
        1) Import from Rain -> 2) Search skins -> 3) Add skins -> 4) Set drop % (must total 100) -> 5) Save case
      </div>
      <div class="row" style="margin-top:8px;">
        <label>Cases:</label>
        <select id="casesSelect" style="min-width:320px"></select>
        <button id="casesRefreshBtn">Refresh</button>
      </div>
      <div class="grid-2" style="margin-top:10px;">
        <div>
          <h3 style="margin:0 0 8px;">Case form</h3>
          <div class="row" style="margin-bottom:6px;">
            <label>Slug</label><input id="caseSlug" style="min-width:180px" />
            <label>Title</label><input id="caseTitle" style="min-width:180px" />
          </div>
          <div class="row" style="margin-bottom:6px;">
            <label>Price (coins)</label><input id="casePriceCoins" type="number" step="0.01" min="0.01" style="width:120px" />
            <label>Logo URL</label><input id="caseLogoUrl" style="min-width:220px" />
          </div>
          <div class="row" style="margin-bottom:6px;">
            <label style="display:flex;align-items:center;gap:6px;"><input id="caseIsActive" type="checkbox" checked />Active</label>
            <button id="caseNewBtn">New</button>
            <button id="caseSaveBtn">Save case</button>
          </div>
          <textarea id="caseDescription" rows="3" placeholder="Description..." style="width:100%;"></textarea>
          <div id="caseVolatility" class="mono" style="margin-top:8px;">Volatility: -</div>
        </div>
        <div>
          <h3 style="margin:0 0 8px;">Simulation</h3>
          <div class="row">
            <label>Rounds</label>
            <input id="casesSimRounds" type="number" min="1" max="1000000" value="100000" style="width:120px" />
            <button id="casesSimBtn">Run RTP simulation</button>
          </div>
          <div id="casesSimStatus" class="mono" style="margin-top:8px;"></div>
        </div>
      </div>
      <h3 style="margin:12px 0 6px;">Selected items for this case</h3>
      <table id="caseItemsTable">
        <thead>
          <tr><th>Skin</th><th>Price</th><th>Drop %</th><th>Action</th></tr>
        </thead>
        <tbody></tbody>
      </table>
      <h3 style="margin:12px 0 6px;">Catalog skins (search results)</h3>
      <table id="catalogSkinsTable">
        <thead>
          <tr><th>Name</th><th>Price</th><th>Source case</th><th>Action</th></tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>

    <script>
      const tokenInput = document.getElementById("token");
      const adminEmailInput = document.getElementById("adminEmail");
      const adminPasswordInput = document.getElementById("adminPassword");
      const loginBtn = document.getElementById("loginBtn");
      const queryInput = document.getElementById("query");
      const limitInput = document.getElementById("limit");
      const allUsersInput = document.getElementById("allUsers");
      const usersTbody = document.querySelector("#usersTable tbody");
      const searchStatus = document.getElementById("searchStatus");
      const authStatus = document.getElementById("authStatus");
      const checkTokenBtn = document.getElementById("checkTokenBtn");
      const detailCard = document.getElementById("detailCard");
      const detailStatus = document.getElementById("detailStatus");
      const detailContent = document.getElementById("detailContent");
      const COIN_CURRENCY = "${PLATFORM_INTERNAL_CURRENCY}";
      const COIN_SYMBOL = "${PLATFORM_VIRTUAL_COIN_SYMBOL}";

      const req = async (url, options = {}) => {
        const token = tokenInput.value.trim();
        const headers = Object.assign({}, options.headers || {}, token ? { Authorization: "Bearer " + token } : {});
        try {
          return await fetch(url, Object.assign({}, options, { headers }));
        } catch (_error) {
          throw new Error("Network error while contacting backend.");
        }
      };

      const amountToAtomic = (amount, decimals = 8) => {
        const n = Number(amount);
        if (!Number.isFinite(n) || n <= 0) return null;
        return String(Math.round(n * Math.pow(10, decimals)));
      };

      const atomicToCoins = (atomic) => {
        const n = Number(atomic);
        if (!Number.isFinite(n)) return 0;
        return n / 1e8;
      };

      const formatCoins = (atomic) => atomicToCoins(atomic).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      const newCasesDraft = () => ({
        caseId: null,
        slug: "",
        title: "",
        description: "",
        logoUrl: "",
        priceCoins: "",
        isActive: true,
        items: []
      });

      const casesState = {
        list: [],
        selectedCaseId: null,
        draft: newCasesDraft(),
        catalog: [],
        simulation: []
      };

      const casesStatus = document.getElementById("casesStatus");
      const casesSelect = document.getElementById("casesSelect");
      const casesImportPages = document.getElementById("casesImportPages");
      const casesImportBtn = document.getElementById("casesImportBtn");
      const casesSkinSearch = document.getElementById("casesSkinSearch");
      const casesSearchSkinsBtn = document.getElementById("casesSearchSkinsBtn");
      const caseSlug = document.getElementById("caseSlug");
      const caseTitle = document.getElementById("caseTitle");
      const casePriceCoins = document.getElementById("casePriceCoins");
      const caseLogoUrl = document.getElementById("caseLogoUrl");
      const caseDescription = document.getElementById("caseDescription");
      const caseIsActive = document.getElementById("caseIsActive");
      const caseVolatility = document.getElementById("caseVolatility");
      const caseNewBtn = document.getElementById("caseNewBtn");
      const caseSaveBtn = document.getElementById("caseSaveBtn");
      const caseItemsTbody = document.querySelector("#caseItemsTable tbody");
      const catalogSkinsTbody = document.querySelector("#catalogSkinsTable tbody");
      const casesRefreshBtn = document.getElementById("casesRefreshBtn");
      const casesSimRounds = document.getElementById("casesSimRounds");
      const casesSimBtn = document.getElementById("casesSimBtn");
      const casesSimStatus = document.getElementById("casesSimStatus");

      const coinsToAtomicString = (coinsValue) => {
        const value = Number(coinsValue);
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error("Invalid case price");
        }
        return String(Math.round(value * 1e8));
      };

      const deriveVolatilityFromDraft = () => {
        if (!casesState.draft.items.length) {
          caseVolatility.textContent = "Volatility: -";
          return;
        }
        const items = casesState.draft.items.map((item) => ({
          p: Number(item.dropRate) / 100,
          v: atomicToCoins(item.valueAtomic)
        }));
        const expected = items.reduce((acc, item) => acc + item.p * item.v, 0);
        if (!Number.isFinite(expected) || expected <= 0) {
          caseVolatility.textContent = "Volatility: -";
          return;
        }
        const variance = items.reduce((acc, item) => {
          const d = item.v - expected;
          return acc + item.p * d * d;
        }, 0);
        const cv = Math.sqrt(Math.max(0, variance)) / expected;
        const index = Math.max(0, Math.min(100, Math.round(cv * 28)));
        const tier = index < 25 ? "L" : index < 50 ? "M" : index < 75 ? "H" : "I";
        caseVolatility.textContent = "Volatility: " + index + " (" + tier + ")";
      };

      const renderCasesSelect = () => {
        casesSelect.innerHTML = "";
        const defaultOpt = document.createElement("option");
        defaultOpt.value = "";
        defaultOpt.textContent = "New case";
        casesSelect.appendChild(defaultOpt);
        for (const c of casesState.list) {
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.textContent = c.title + " (" + c.slug + ") [" + c.volatilityTier + " " + c.volatilityIndex + "]";
          casesSelect.appendChild(opt);
        }
        casesSelect.value = casesState.selectedCaseId || "";
      };

      const renderCaseItems = () => {
        caseItemsTbody.innerHTML = "";
        casesState.draft.items.forEach((item, idx) => {
          const tr = document.createElement("tr");
          tr.innerHTML =
            "<td><div><strong>" + item.name + "</strong></div><div class=\\"mono\\">skinId=" + (item.cs2SkinId || "-") + "</div></td>" +
            "<td class=\\"mono\\">" + formatCoins(item.valueAtomic) + "</td>" +
            "<td><input data-idx=\\"" + idx + "\\" class=\\"case-drop\\" type=\\"number\\" min=\\"0.0001\\" max=\\"100\\" step=\\"0.0001\\" value=\\"" + Number(item.dropRate).toFixed(4) + "\\" style=\\"width:110px\\" /></td>" +
            "<td><button data-idx=\\"" + idx + "\\" class=\\"case-remove danger\\">Remove</button></td>";
          caseItemsTbody.appendChild(tr);
        });
        caseItemsTbody.querySelectorAll(".case-remove").forEach((btn) => {
          btn.addEventListener("click", () => {
            const idx = Number(btn.getAttribute("data-idx"));
            casesState.draft.items.splice(idx, 1);
            renderCaseItems();
            deriveVolatilityFromDraft();
          });
        });
        caseItemsTbody.querySelectorAll(".case-drop").forEach((input) => {
          input.addEventListener("change", () => {
            const idx = Number(input.getAttribute("data-idx"));
            casesState.draft.items[idx].dropRate = String(Number(input.value || "0"));
            deriveVolatilityFromDraft();
          });
        });
      };

      const renderCatalogSkins = () => {
        catalogSkinsTbody.innerHTML = "";
        for (const skin of casesState.catalog) {
          const tr = document.createElement("tr");
          tr.innerHTML =
            "<td><div><strong>" + skin.name + "</strong></div><div class=\\"mono\\">" + skin.id + "</div></td>" +
            "<td class=\\"mono\\">" + formatCoins(skin.valueAtomic) + "</td>" +
            "<td class=\\"mono\\">" + (skin.sourceCaseSlug || "-") + "</td>" +
            "<td><button class=\\"case-add success\\">Add</button></td>";
          tr.querySelector(".case-add").addEventListener("click", () => {
            casesState.draft.items.push({
              name: skin.name,
              valueAtomic: skin.valueAtomic,
              dropRate: "0",
              imageUrl: skin.imageUrl || undefined,
              cs2SkinId: skin.id,
              isActive: true
            });
            renderCaseItems();
            deriveVolatilityFromDraft();
          });
          catalogSkinsTbody.appendChild(tr);
        }
      };

      const bindDraftFields = () => {
        caseSlug.value = casesState.draft.slug;
        caseTitle.value = casesState.draft.title;
        casePriceCoins.value = casesState.draft.priceCoins;
        caseLogoUrl.value = casesState.draft.logoUrl;
        caseDescription.value = casesState.draft.description;
        caseIsActive.checked = casesState.draft.isActive;
      };

      const pullDraftFromFields = () => {
        casesState.draft.slug = caseSlug.value.trim();
        casesState.draft.title = caseTitle.value.trim();
        casesState.draft.priceCoins = casePriceCoins.value.trim();
        casesState.draft.logoUrl = caseLogoUrl.value.trim();
        casesState.draft.description = caseDescription.value.trim();
        casesState.draft.isActive = !!caseIsActive.checked;
      };

      const pickCaseForEdit = (id) => {
        if (!id) {
          casesState.selectedCaseId = null;
          casesState.draft = newCasesDraft();
          bindDraftFields();
          renderCaseItems();
          deriveVolatilityFromDraft();
          return;
        }
        const row = casesState.list.find((c) => c.id === id);
        if (!row) return;
        casesState.selectedCaseId = id;
        casesState.draft = {
          caseId: row.id,
          slug: row.slug || "",
          title: row.title || "",
          description: row.description || "",
          logoUrl: row.logoUrl || "",
          priceCoins: String(atomicToCoins(row.priceAtomic)),
          isActive: !!row.isActive,
          items: (row.items || []).map((it) => ({
            name: it.name,
            valueAtomic: it.valueAtomic,
            dropRate: String(it.dropRate),
            imageUrl: it.imageUrl || undefined,
            cs2SkinId: it.cs2SkinId || undefined,
            isActive: it.isActive
          }))
        };
        bindDraftFields();
        renderCaseItems();
        deriveVolatilityFromDraft();
      };

      const loadCases = async () => {
        const res = await req("/api/v1/cases/admin/cases");
        if (!res.ok) throw new Error(await getErrorMessage(res, "Failed to load cases"));
        casesState.list = await res.json();
        renderCasesSelect();
      };

      const loadCatalog = async () => {
        const params = new URLSearchParams();
        params.set("limit", "200");
        const q = casesSkinSearch.value.trim();
        if (q) params.set("q", q);
        const res = await req("/api/v1/cases/admin/catalog/skins?" + params.toString());
        if (!res.ok) throw new Error(await getErrorMessage(res, "Failed to load skins"));
        casesState.catalog = await res.json();
        renderCatalogSkins();
      };

      casesSelect.addEventListener("change", () => pickCaseForEdit(casesSelect.value));
      casesRefreshBtn.addEventListener("click", async () => {
        try {
          await loadCases();
          casesStatus.className = "mono ok";
          casesStatus.textContent = "Cases refreshed.";
        } catch (error) {
          casesStatus.className = "mono err";
          casesStatus.textContent = error && error.message ? error.message : "Failed to refresh cases.";
        }
      });
      caseNewBtn.addEventListener("click", () => pickCaseForEdit(""));
      casesSearchSkinsBtn.addEventListener("click", async () => {
        try {
          await loadCatalog();
          casesStatus.className = "mono ok";
          casesStatus.textContent = "Catalog updated (" + casesState.catalog.length + " skins).";
        } catch (error) {
          casesStatus.className = "mono err";
          casesStatus.textContent = error && error.message ? error.message : "Failed to load catalog.";
        }
      });
      casesImportBtn.addEventListener("click", async () => {
        try {
          casesStatus.className = "mono";
          casesStatus.textContent = "Importing Rain catalog...";
          const pages = Math.max(1, Math.min(20, Number(casesImportPages.value || "6")));
          const res = await req("/api/v1/cases/admin/catalog/import-rain", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pages })
          });
          if (!res.ok) throw new Error(await getErrorMessage(res, "Import failed"));
          const summary = await res.json();
          casesStatus.className = "mono ok";
          casesStatus.textContent = "Imported: pages=" + summary.pagesScanned + " cases=" + summary.casesParsed + " skins=" + summary.skinsUpserted;
          await loadCatalog();
        } catch (error) {
          casesStatus.className = "mono err";
          casesStatus.textContent = error && error.message ? error.message : "Import failed.";
        }
      });
      caseSaveBtn.addEventListener("click", async () => {
        try {
          pullDraftFromFields();
          if (!casesState.draft.slug || !casesState.draft.title) {
            throw new Error("Slug and title are required.");
          }
          if (!casesState.draft.items.length) {
            throw new Error("Add at least 1 skin.");
          }
          const payload = {
            caseId: casesState.draft.caseId || undefined,
            slug: casesState.draft.slug,
            title: casesState.draft.title,
            description: casesState.draft.description || undefined,
            logoUrl: casesState.draft.logoUrl || undefined,
            priceAtomic: coinsToAtomicString(casesState.draft.priceCoins),
            isActive: casesState.draft.isActive,
            items: casesState.draft.items.map((item, idx) => ({
              name: item.name,
              valueAtomic: String(item.valueAtomic),
              dropRate: String(item.dropRate),
              imageUrl: item.imageUrl || undefined,
              sortOrder: idx,
              isActive: item.isActive !== false,
              cs2SkinId: item.cs2SkinId || undefined
            }))
          };
          const idempotency = "admin-cases:" + Date.now() + ":" + Math.random().toString(16).slice(2);
          const res = await req("/api/v1/cases/admin/cases", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": idempotency },
            body: JSON.stringify(payload)
          });
          if (!res.ok) throw new Error(await getErrorMessage(res, "Failed to save case"));
          const saved = await res.json();
          casesStatus.className = "mono ok";
          casesStatus.textContent = "Saved case: " + saved.title;
          await loadCases();
          pickCaseForEdit(saved.id);
        } catch (error) {
          casesStatus.className = "mono err";
          casesStatus.textContent = error && error.message ? error.message : "Failed to save case.";
        }
      });
      casesSimBtn.addEventListener("click", async () => {
        try {
          casesSimStatus.className = "mono";
          casesSimStatus.textContent = "Running simulation...";
          const rounds = Math.max(1, Math.min(1000000, Number(casesSimRounds.value || "100000")));
          const res = await req("/api/v1/cases/admin/simulate-rtp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rounds })
          });
          if (!res.ok) throw new Error(await getErrorMessage(res, "Simulation failed"));
          const rows = await res.json();
          casesState.simulation = rows;
          const summary = rows
            .slice(0, 6)
            .map((r) => r.caseTitle + " RTP=" + r.rtpPercent + "% VOL=" + r.volatilityTier + " (" + r.volatilityIndex + ")")
            .join("\\n");
          casesSimStatus.className = "mono ok";
          casesSimStatus.textContent = summary || "No cases to simulate.";
        } catch (error) {
          casesSimStatus.className = "mono err";
          casesSimStatus.textContent = error && error.message ? error.message : "Simulation failed.";
        }
      });

      const getErrorMessage = async (res, fallback) => {
        const data = await res.json().catch(() => ({}));
        return (data && data.message) ? data.message : fallback;
      };

      const bootCasesAdmin = async () => {
        try {
          await loadCases();
          pickCaseForEdit("");
          await loadCatalog();
          casesStatus.className = "mono ok";
          casesStatus.textContent = "Cases admin ready.";
        } catch (error) {
          casesStatus.className = "mono err";
          casesStatus.textContent = error && error.message ? error.message : "Failed to initialize cases admin.";
        }
      };
      void bootCasesAdmin();

      const persistToken = () => {
        try { localStorage.setItem("admin_panel_token", tokenInput.value.trim()); } catch (_e) {}
      };

      const persistAdminEmail = () => {
        try { localStorage.setItem("admin_panel_email", adminEmailInput.value.trim()); } catch (_e) {}
      };

      const restoreToken = () => {
        try {
          const saved = localStorage.getItem("admin_panel_token");
          if (saved) tokenInput.value = saved;
        } catch (_e) {}
      };

      const restoreAdminEmail = () => {
        try {
          const saved = localStorage.getItem("admin_panel_email");
          if (saved) adminEmailInput.value = saved;
        } catch (_e) {}
      };

      const openUserDetails = async (userId, email) => {
        detailCard.style.display = "block";
        detailStatus.className = "mono";
        detailStatus.textContent = "Loading details for " + email + "...";
        detailContent.innerHTML = "";
        try {
          const res = await req("/api/v1/admin/users/" + encodeURIComponent(userId) + "/details?limit=300");
          if (!res.ok) {
            detailStatus.className = "mono err";
            detailStatus.textContent = await getErrorMessage(res, "Failed to load details");
            return;
          }
          const data = await res.json();
          detailStatus.className = "mono ok";
          detailStatus.textContent = "Loaded details for " + data.user.email;

          const summary = data.summary || {};
          const perGame = summary.perGame || {};
          const wallets = (data.wallets || []).map((w) =>
            "<div class=\\"mono\\">wallet=" + w.id + " " + w.currency + " bal=" + w.balanceAtomic + " locked=" + w.lockedAtomic + " avail=" + w.availableAtomic + "</div>"
          ).join("");

          const movementsRows = (data.movements || []).map((m) =>
            "<tr>" +
              "<td class=\\"mono\\">" + m.createdAt + "</td>" +
              "<td class=\\"mono\\">" + m.tag + "</td>" +
              "<td class=\\"mono\\">" + m.direction + "</td>" +
              "<td class=\\"mono\\">" + m.signedAtomic + "</td>" +
              "<td class=\\"mono\\">" + (m.referenceId || "") + "</td>" +
            "</tr>"
          ).join("");

          detailContent.innerHTML =
            "<div class=\\"grid-2\\">" +
              "<div>" +
                "<h3>User</h3>" +
                "<div class=\\"mono\\">publicId=#" + (data.user.publicId ?? "-") + " | id=" + data.user.id + "</div>" +
                "<div class=\\"mono\\">email=" + data.user.email + "</div>" +
                "<div class=\\"mono\\">role=" + data.user.role + " status=" + data.user.status + "</div>" +
                "<div class=\\"mono\\">level=" + data.user.level + " xpAtomic=" + data.user.levelXpAtomic + "</div>" +
                "<div class=\\"mono\\">createdAt=" + data.user.createdAt + "</div>" +
              "</div>" +
              "<div>" +
                "<h3>Wallets (" + COIN_SYMBOL + ")</h3>" +
                (wallets || "<div class=\\"mono\\">No wallet found</div>") +
              "</div>" +
            "</div>" +
            "<div class=\\"grid-2\\" style=\\"margin-top:12px;\\">" +
              "<div>" +
                "<h3>Financial summary</h3>" +
                "<div class=\\"mono\\">totalDepositsAtomic=" + (summary.totalDepositsAtomic || "0") + "</div>" +
                "<div class=\\"mono\\">totalWithdrawalsAtomic=" + (summary.totalWithdrawalsAtomic || "0") + "</div>" +
                "<div class=\\"mono\\">totalWithdrawalFeesAtomic=" + (summary.totalWithdrawalFeesAtomic || "0") + "</div>" +
                "<div class=\\"mono\\">rewardsRedeemedAtomic=" + (summary.rewardsRedeemedAtomic || "0") + "</div>" +
                "<div class=\\"mono\\">totalWageredAtomic=" + (summary.totalWageredAtomic || "0") + "</div>" +
                "<div class=\\"mono\\">totalPayoutAtomic=" + (summary.totalPayoutAtomic || "0") + "</div>" +
                "<div class=\\"mono\\">houseProfitAtomic=" + (summary.houseProfitAtomic || "0") + "</div>" +
                "<div class=\\"mono\\">netPlayerGamingAtomic=" + (summary.netPlayerGamingAtomic || "0") + "</div>" +
              "</div>" +
              "<div>" +
                "<h3>Spent by game</h3>" +
                "<div class=\\"mono\\">mines wagered=" + ((perGame.mines && perGame.mines.wageredAtomic) || "0") + " payout=" + ((perGame.mines && perGame.mines.payoutAtomic) || "0") + " net=" + ((perGame.mines && perGame.mines.netAtomic) || "0") + "</div>" +
                "<div class=\\"mono\\">blackjack wagered=" + ((perGame.blackjack && perGame.blackjack.wageredAtomic) || "0") + " payout=" + ((perGame.blackjack && perGame.blackjack.payoutAtomic) || "0") + " net=" + ((perGame.blackjack && perGame.blackjack.netAtomic) || "0") + "</div>" +
                "<div class=\\"mono\\">roulette wagered=" + ((perGame.roulette && perGame.roulette.wageredAtomic) || "0") + " payout=" + ((perGame.roulette && perGame.roulette.payoutAtomic) || "0") + " net=" + ((perGame.roulette && perGame.roulette.netAtomic) || "0") + "</div>" +
              "</div>" +
            "</div>" +
            "<h3 style=\\"margin-top:12px;\\">Movement history</h3>" +
            "<table class=\\"detail-table\\"><thead><tr><th>At</th><th>Tag</th><th>Direction</th><th>Signed atomic</th><th>Reference</th></tr></thead><tbody>" +
            (movementsRows || "<tr><td colspan=\\"5\\" class=\\"mono\\">No movements</td></tr>") +
            "</tbody></table>";
        } catch (error) {
          detailStatus.className = "mono err";
          detailStatus.textContent = error && error.message ? error.message : "Failed to load details";
        }
      };

      const setUserAccess = async (userId, status, role, msgEl) => {
        try {
          const res = await req("/api/v1/admin/users/" + encodeURIComponent(userId) + "/access", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status, role })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            msgEl.className = "mono err";
            msgEl.textContent = (data && data.message) ? data.message : "Failed to update user access";
            return;
          }
          msgEl.className = "mono ok";
          msgEl.textContent = "Updated: role=" + data.user.role + " status=" + data.user.status;
          document.getElementById("searchBtn").click();
        } catch (error) {
          msgEl.className = "mono err";
          msgEl.textContent = error && error.message ? error.message : "Failed to update user access";
        }
      };

      const renderUsers = (users) => {
        usersTbody.innerHTML = "";
        for (const user of users) {
          const tr = document.createElement("tr");
          const walletLines = (user.wallets || []).map((w) =>
            "<div class=\\"mono\\">" +
            w.currency +
            " balance=" + w.balanceAtomic +
            " locked=" + w.lockedAtomic +
            " available=" + w.availableAtomic +
            "</div>"
          ).join("");
          const pending = user.status !== "ACTIVE";
          tr.innerHTML = \`
            <td>
              <div><strong>\${user.email}</strong></div>
              <div class="mono">publicId=#\${user.publicId ?? "-"} | id=\${user.id}</div>
              <div class="mono">role=\${user.role} status=\${user.status}</div>
              <div class="mono">level=\${user.level} xpAtomic=\${user.levelXpAtomic}</div>
              <div class="mono">createdAt=\${user.createdAt} updatedAt=\${user.updatedAt}</div>
              \${pending ? '<span class="pill warn">Pending approval</span>' : '<span class="pill success">Active</span>'}
            </td>
            <td>\${walletLines || "<span class=\\"mono\\">No wallets</span>"}</td>
            <td>
              <div class="row">
                <span class="mono">\${COIN_SYMBOL} only (\${COIN_CURRENCY})</span>
                <input class="amount" placeholder="Amount (human)" />
                <button class="credit">+ Credit</button>
                <button class="debit">- Debit</button>
              </div>
              <div class="actions">
                <button class="approve success">Approve (PLAYER+ACTIVE)</button>
                <button class="suspend danger">Suspend</button>
                <button class="details">View details</button>
              </div>
              <div class="mono msg"></div>
            </td>
          \`;

          const amountEl = tr.querySelector(".amount");
          const msgEl = tr.querySelector(".msg");
          const doAdjust = async (sign) => {
            try {
              msgEl.textContent = "";
              const atomic = amountToAtomic(amountEl.value);
              if (!atomic) {
                msgEl.textContent = "Invalid amount.";
                msgEl.className = "mono msg err";
                return;
              }
              const idempotency = "admin-panel:" + Date.now() + ":" + Math.random().toString(16).slice(2);
              const amountAtomic = sign === "-" ? "-" + atomic : atomic;
              const res = await req("/api/v1/admin/wallets/adjust", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Idempotency-Key": idempotency },
                body: JSON.stringify({
                  userId: user.id,
                  amountAtomic,
                  reason: "ADMIN_ADJUSTMENT",
                  referenceId: "admin-panel"
                })
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) {
                msgEl.textContent = (data && data.message) ? data.message : "Adjustment failed.";
                msgEl.className = "mono msg err";
                return;
              }
              msgEl.textContent = "OK. " + COIN_CURRENCY + " balanceAtomic=" + data.balanceAtomic;
              msgEl.className = "mono msg ok";
            } catch (error) {
              msgEl.textContent = error && error.message ? error.message : "Adjustment failed.";
              msgEl.className = "mono msg err";
            }
          };

          tr.querySelector(".credit").addEventListener("click", () => void doAdjust("+"));
          tr.querySelector(".debit").addEventListener("click", () => void doAdjust("-"));
          tr.querySelector(".approve").addEventListener("click", () => void setUserAccess(user.id, "ACTIVE", "PLAYER", msgEl));
          tr.querySelector(".suspend").addEventListener("click", () => void setUserAccess(user.id, "SUSPENDED", user.role, msgEl));
          tr.querySelector(".details").addEventListener("click", () => void openUserDetails(user.id, user.email));
          usersTbody.appendChild(tr);
        }
      };

      document.getElementById("searchBtn").addEventListener("click", async () => {
        try {
          persistToken();
          searchStatus.textContent = "Searching...";
          searchStatus.className = "mono";
          const q = encodeURIComponent(queryInput.value.trim());
          const params = new URLSearchParams();
          if (q) {
            params.set("q", decodeURIComponent(q));
          }
          const limit = Number(limitInput.value);
          if (Number.isFinite(limit) && limit > 0) {
            params.set("limit", String(Math.min(5000, Math.trunc(limit))));
          }
          if (allUsersInput.checked) {
            params.set("all", "true");
          } else {
            params.set("all", "false");
          }
          const res = await req("/api/v1/admin/users?" + params.toString());
          if (!res.ok) {
            searchStatus.textContent = await getErrorMessage(res, "Search failed");
            searchStatus.className = "err";
            usersTbody.innerHTML = "";
            return;
          }
          const data = await res.json().catch(() => ({ users: [] }));
          const pendingCount = Number(data.pendingApprovalCount || 0);
          searchStatus.textContent = "Showing " + data.users.length + " / " + data.totalUsers + " user(s) | pending approval: " + pendingCount;
          searchStatus.className = pendingCount > 0 ? "ok" : "mono";
          renderUsers(data.users);
        } catch (error) {
          searchStatus.textContent = error && error.message ? error.message : "Search failed";
          searchStatus.className = "err";
        }
      });

      checkTokenBtn.addEventListener("click", async () => {
        authStatus.textContent = "";
        authStatus.className = "mono";
        const token = tokenInput.value.trim();
        if (!token) {
          authStatus.textContent = "Paste access token first.";
          authStatus.className = "mono err";
          return;
        }
        try {
          persistToken();
          const meRes = await req("/api/v1/users/me");
          if (!meRes.ok) {
            authStatus.textContent = await getErrorMessage(meRes, "Token is invalid.");
            authStatus.className = "mono err";
            return;
          }
          const me = await meRes.json();
          if (me.role !== "ADMIN") {
            authStatus.textContent = "Token valid, but user role is " + me.role + " (ADMIN required).";
            authStatus.className = "mono err";
            return;
          }
          authStatus.textContent = "Token valid. ADMIN access granted for " + me.email + ".";
          authStatus.className = "mono ok";
        } catch (error) {
          authStatus.textContent = error && error.message ? error.message : "Unable to validate token.";
          authStatus.className = "mono err";
        }
      });

      loginBtn.addEventListener("click", async () => {
        authStatus.textContent = "";
        authStatus.className = "mono";
        const email = adminEmailInput.value.trim();
        const password = adminPasswordInput.value;
        if (!email || !password) {
          authStatus.textContent = "Enter admin email and password first.";
          authStatus.className = "mono err";
          return;
        }
        try {
          persistAdminEmail();
          const res = await fetch("/api/v1/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            authStatus.textContent = (data && data.message) ? data.message : "Login failed.";
            authStatus.className = "mono err";
            return;
          }
          if (!data || !data.tokens || !data.tokens.accessToken) {
            authStatus.textContent = "Login response is missing access token.";
            authStatus.className = "mono err";
            return;
          }
          if (!data.user || data.user.role !== "ADMIN") {
            authStatus.textContent = "Login succeeded, but this user is not ADMIN.";
            authStatus.className = "mono err";
            tokenInput.value = "";
            persistToken();
            return;
          }
          tokenInput.value = data.tokens.accessToken;
          persistToken();
          adminPasswordInput.value = "";
          authStatus.textContent = "Login OK. ADMIN access granted for " + data.user.email + ".";
          authStatus.className = "mono ok";
          document.getElementById("searchBtn").click();
        } catch (error) {
          authStatus.textContent = error && error.message ? error.message : "Login failed.";
          authStatus.className = "mono err";
        }
      });

      document.getElementById("logoutBtn").addEventListener("click", async () => {
        const token = tokenInput.value.trim();
        if (!token) {
          authStatus.textContent = "Paste access token first.";
          authStatus.className = "mono err";
          return;
        }
        try {
          const res = await req("/api/v1/auth/logout", { method: "POST" });
          if (res.status === 204) {
            authStatus.textContent = "Logout OK for current token/session.";
            authStatus.className = "mono ok";
            return;
          }
          authStatus.textContent = await getErrorMessage(res, "Logout failed.");
          authStatus.className = "mono err";
        } catch (error) {
          authStatus.textContent = error && error.message ? error.message : "Logout failed.";
          authStatus.className = "mono err";
        }
      });

      queryInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          document.getElementById("searchBtn").click();
        }
      });

      adminPasswordInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          loginBtn.click();
        }
      });

      tokenInput.addEventListener("change", persistToken);
      adminEmailInput.addEventListener("change", persistAdminEmail);
      restoreToken();
      restoreAdminEmail();
      if (tokenInput.value.trim()) {
        document.getElementById("searchBtn").click();
      }
    </script>
  </body>
</html>`;

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/blackjack/payout-config", { preHandler: requireRoles(["ADMIN"]) }, async (_request, reply) => {
    const cfg = await getBlackjackPayoutConfig();
    return reply.send(cfg);
  });

  fastify.put(
    "/blackjack/payout-config",
    {
      preHandler: [requireRoles(["ADMIN"]), requireIdempotencyKey]
    },
    async (request, reply) => {
      const body = z
        .object({
          pairsMultiplier: z.coerce.number().int().min(2).max(50),
          plus3Multiplier: z.coerce.number().int().min(2).max(50)
        })
        .parse(request.body);

      const updated = await setBlackjackPayoutConfig({
        pairsMultiplier: new Prisma.Decimal(body.pairsMultiplier),
        plus3Multiplier: new Prisma.Decimal(body.plus3Multiplier)
      });

      return reply.send(updated);
    }
  );

  fastify.get("/panel", async (_request, reply) => {
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
    );
    reply.header("Cache-Control", "no-store");
    return reply.type("text/html; charset=utf-8").send(ADMIN_PANEL_HTML);
  });

  fastify.get(
    "/users",
    {
      preHandler: [requireRoles(["ADMIN"])]
    },
    async (request, reply) => {
      const query = userSearchQuerySchema.parse(request.query);
      const qPublicId = query.q ? Number.parseInt(query.q, 10) : Number.NaN;
      const where = query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: "insensitive" as const } },
              { id: { equals: query.q } },
              ...(Number.isInteger(qPublicId) && qPublicId > 0 ? [{ publicId: { equals: qPublicId } }] : [])
            ]
          }
        : {};

      const [totalUsers, pendingApprovalCount] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.count({ where: { ...where, status: UserStatus.SUSPENDED, role: UserRole.PLAYER } })
      ]);
      const take = query.all ? undefined : query.limit;

      const rows = await prisma.user.findMany({
        where,
        orderBy: {
          createdAt: "desc"
        },
        take,
        select: {
          id: true,
          publicId: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          levelXpAtomic: true,
          wallets: {
            where: { currency: PLATFORM_INTERNAL_CURRENCY },
            select: {
              id: true,
              currency: true,
              balanceAtomic: true,
              lockedAtomic: true,
              updatedAt: true
            },
            orderBy: {
              createdAt: "asc"
            }
          }
        }
      }).catch(async (error) => {
        if (!isMissingLevelXpColumnError(error)) {
          throw error;
        }
        const legacyRows = await prisma.user.findMany({
          where,
          orderBy: {
            createdAt: "desc"
          },
          take,
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            wallets: {
              where: { currency: PLATFORM_INTERNAL_CURRENCY },
              select: {
                id: true,
                currency: true,
                balanceAtomic: true,
                lockedAtomic: true,
                updatedAt: true
              },
              orderBy: {
                createdAt: "asc"
              }
            }
          }
        });
        return legacyRows.map((row) => ({
          ...row,
          publicId: null,
          levelXpAtomic: 0n
        }));
      });

      return reply.send({
        totalUsers,
        pendingApprovalCount,
        users: rows.map((user) => ({
          id: user.id,
          publicId: user.publicId ?? null,
          email: user.email,
          role: user.role,
          status: user.status,
          level: getLevelFromXp(user.levelXpAtomic),
          levelXpAtomic: user.levelXpAtomic.toString(),
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          wallets: user.wallets.map((wallet) => ({
            id: wallet.id,
            currency: wallet.currency,
            balanceAtomic: wallet.balanceAtomic.toString(),
            lockedAtomic: wallet.lockedAtomic.toString(),
            availableAtomic: (wallet.balanceAtomic - wallet.lockedAtomic).toString(),
            updatedAt: wallet.updatedAt
          }))
        }))
      });
    }
  );

  fastify.patch(
    "/users/:userId/access",
    {
      preHandler: [requireRoles(["ADMIN"])]
    },
    async (request, reply) => {
      const params = userDetailParamsSchema.parse(request.params);
      const body = updateUserStatusSchema.parse(request.body);

      const updated = await prisma.user.update({
        where: { id: params.userId },
        data: {
          status: body.status,
          ...(body.role ? { role: body.role } : {})
        },
        select: {
          id: true,
          publicId: true,
          email: true,
          role: true,
          status: true,
          updatedAt: true
        }
      });

      return reply.send({
        user: {
          id: updated.id,
          email: updated.email,
          role: updated.role,
          status: updated.status,
          updatedAt: updated.updatedAt
        }
      });
    }
  );

  fastify.get(
    "/users/:userId/details",
    {
      preHandler: [requireRoles(["ADMIN"])]
    },
    async (request, reply) => {
      const params = userDetailParamsSchema.parse(request.params);
      const query = userDetailQuerySchema.parse(request.query);

      const userRow = await prisma.user.findUnique({
        where: { id: params.userId },
        select: {
          id: true,
          publicId: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          levelXpAtomic: true,
          wallets: {
            where: { currency: PLATFORM_INTERNAL_CURRENCY },
            select: {
              id: true,
              currency: true,
              balanceAtomic: true,
              lockedAtomic: true,
              updatedAt: true
            },
            orderBy: { createdAt: "asc" }
          }
        }
      }).catch(async (error) => {
        if (!isMissingLevelXpColumnError(error)) {
          throw error;
        }
        const legacy = await prisma.user.findUnique({
          where: { id: params.userId },
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            wallets: {
              where: { currency: PLATFORM_INTERNAL_CURRENCY },
              select: {
                id: true,
                currency: true,
                balanceAtomic: true,
                lockedAtomic: true,
                updatedAt: true
              },
              orderBy: { createdAt: "asc" }
            }
          }
        });
        if (!legacy) {
          return null;
        }
        return {
          ...legacy,
          publicId: null,
          levelXpAtomic: 0n
        };
      });

      if (!userRow) {
        throw new AppError("User not found", 404, "USER_NOT_FOUND");
      }

      const [depositsAgg, withdrawalsAgg, minesAgg, blackjackAgg, rouletteAgg, movements] = await Promise.all([
        prisma.deposit.aggregate({
          where: {
            userId: params.userId,
            currency: PLATFORM_INTERNAL_CURRENCY,
            status: DepositStatus.COMPLETED
          },
          _sum: {
            amountAtomic: true
          }
        }),
        prisma.withdrawal.aggregate({
          where: {
            userId: params.userId,
            currency: PLATFORM_INTERNAL_CURRENCY,
            status: WithdrawalStatus.COMPLETED
          },
          _sum: {
            amountAtomic: true,
            feeAtomic: true
          }
        }),
        prisma.minesGame.aggregate({
          where: {
            userId: params.userId,
            currency: PLATFORM_INTERNAL_CURRENCY
          },
          _sum: {
            betAtomic: true,
            payoutAtomic: true
          }
        }),
        prisma.blackjackGame.aggregate({
          where: {
            userId: params.userId,
            currency: PLATFORM_INTERNAL_CURRENCY
          },
          _sum: {
            initialBetAtomic: true,
            payoutAtomic: true
          }
        }),
        prisma.rouletteBet.aggregate({
          where: {
            userId: params.userId,
            currency: PLATFORM_INTERNAL_CURRENCY
          },
          _sum: {
            stakeAtomic: true,
            payoutAtomic: true
          }
        }),
        prisma.ledgerEntry.findMany({
          where: {
            wallet: {
              userId: params.userId,
              currency: PLATFORM_INTERNAL_CURRENCY
            }
          },
          orderBy: {
            createdAt: "desc"
          },
          take: query.limit,
          select: {
            id: true,
            walletId: true,
            direction: true,
            reason: true,
            amountAtomic: true,
            balanceBeforeAtomic: true,
            balanceAfterAtomic: true,
            referenceId: true,
            idempotencyKey: true,
            metadata: true,
            createdAt: true
          }
        })
      ]);

      const minesWagered = minesAgg._sum.betAtomic ?? 0n;
      const minesPayout = minesAgg._sum.payoutAtomic ?? 0n;
      const blackjackWagered = blackjackAgg._sum.initialBetAtomic ?? 0n;
      const blackjackPayout = blackjackAgg._sum.payoutAtomic ?? 0n;
      const rouletteWagered = rouletteAgg._sum.stakeAtomic ?? 0n;
      const roulettePayout = rouletteAgg._sum.payoutAtomic ?? 0n;

      const totalWageredAtomic = minesWagered + blackjackWagered + rouletteWagered;
      const totalPayoutAtomic = minesPayout + blackjackPayout + roulettePayout;
      const houseProfitAtomic = totalWageredAtomic - totalPayoutAtomic;
      const netPlayerGamingAtomic = totalPayoutAtomic - totalWageredAtomic;

      const movementRows = movements.map((row) => {
        const metadata =
          row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
            ? (row.metadata as Record<string, unknown>)
            : {};
        const game = typeof metadata.game === "string" ? metadata.game : null;
        const operation = typeof metadata.operation === "string" ? metadata.operation : null;
        const tag = game ? (operation ? `${game}:${operation}` : game) : row.reason;
        const signedAtomic = row.direction === LedgerDirection.CREDIT ? row.amountAtomic : -row.amountAtomic;

        return {
          id: row.id,
          createdAt: row.createdAt,
          walletId: row.walletId,
          direction: row.direction,
          reason: row.reason,
          game: game ?? null,
          operation: operation ?? null,
          tag,
          amountAtomic: row.amountAtomic.toString(),
          signedAtomic: signedAtomic.toString(),
          balanceBeforeAtomic: row.balanceBeforeAtomic.toString(),
          balanceAfterAtomic: row.balanceAfterAtomic.toString(),
          referenceId: row.referenceId,
          idempotencyKey: row.idempotencyKey,
          metadata
        };
      });

      return reply.send({
        user: {
          id: userRow.id,
          publicId: userRow.publicId ?? null,
          email: userRow.email,
          role: userRow.role,
          status: userRow.status,
          level: getLevelFromXp(userRow.levelXpAtomic),
          levelXpAtomic: userRow.levelXpAtomic.toString(),
          createdAt: userRow.createdAt,
          updatedAt: userRow.updatedAt
        },
        wallets: userRow.wallets.map((wallet) => ({
          id: wallet.id,
          currency: wallet.currency,
          balanceAtomic: wallet.balanceAtomic.toString(),
          lockedAtomic: wallet.lockedAtomic.toString(),
          availableAtomic: (wallet.balanceAtomic - wallet.lockedAtomic).toString(),
          updatedAt: wallet.updatedAt
        })),
        summary: {
          totalDepositsAtomic: (depositsAgg._sum.amountAtomic ?? 0n).toString(),
          totalWithdrawalsAtomic: (withdrawalsAgg._sum.amountAtomic ?? 0n).toString(),
          totalWithdrawalFeesAtomic: (withdrawalsAgg._sum.feeAtomic ?? 0n).toString(),
          rewardsRedeemedAtomic: "0",
          totalWageredAtomic: totalWageredAtomic.toString(),
          totalPayoutAtomic: totalPayoutAtomic.toString(),
          houseProfitAtomic: houseProfitAtomic.toString(),
          netPlayerGamingAtomic: netPlayerGamingAtomic.toString(),
          perGame: {
            mines: {
              wageredAtomic: minesWagered.toString(),
              payoutAtomic: minesPayout.toString(),
              netAtomic: (minesPayout - minesWagered).toString()
            },
            blackjack: {
              wageredAtomic: blackjackWagered.toString(),
              payoutAtomic: blackjackPayout.toString(),
              netAtomic: (blackjackPayout - blackjackWagered).toString()
            },
            roulette: {
              wageredAtomic: rouletteWagered.toString(),
              payoutAtomic: roulettePayout.toString(),
              netAtomic: (roulettePayout - rouletteWagered).toString()
            }
          }
        },
        movements: movementRows
      });
    }
  );

  fastify.post(
    "/wallets/adjust",
    {
      preHandler: [requireRoles(["ADMIN"]), requireIdempotencyKey]
    },
    async (request, reply) => {
      const body = adjustByAdminSchema.parse(request.body);
      let targetUserId = body.userId;

      if (!targetUserId) {
        const user = await prisma.user.findUnique({
          where: {
            email: body.email
          },
          select: {
            id: true
          }
        });
        if (!user) {
          throw new AppError("User not found by email", 404, "USER_NOT_FOUND");
        }
        targetUserId = user.id;
      }

      const result = await adjustWalletBalance({
        actorUserId: request.user.sub,
        userId: targetUserId,
        currency: PLATFORM_INTERNAL_CURRENCY,
        amountAtomic: body.amountAtomic,
        reason: body.reason,
        idempotencyKey: request.idempotencyKey,
        metadata: body.metadata,
        referenceId: body.referenceId
      });

      return reply.send({
        targetUserId,
        currency: PLATFORM_INTERNAL_CURRENCY,
        entry: {
          id: result.entry.id,
          walletId: result.entry.walletId,
          direction: result.entry.direction,
          reason: result.entry.reason,
          amountAtomic: result.entry.amountAtomic.toString(),
          balanceBeforeAtomic: result.entry.balanceBeforeAtomic.toString(),
          balanceAfterAtomic: result.entry.balanceAfterAtomic.toString(),
          referenceId: result.entry.referenceId,
          idempotencyKey: result.entry.idempotencyKey,
          createdAt: result.entry.createdAt
        },
        balanceAtomic: result.balanceAtomic.toString()
      });
    }
  );
};
