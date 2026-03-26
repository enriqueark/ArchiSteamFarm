import { Currency, LedgerReason } from "@prisma/client";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { requireRoles } from "../../core/auth";
import { AppError } from "../../core/errors";
import { requireIdempotencyKey } from "../../core/idempotency";
import { prisma } from "../../infrastructure/db/prisma";
import { adjustWalletBalance } from "../ledger/service";
import { getBlackjackPayoutConfig, setBlackjackPayoutConfig } from "../blackjack/config";

const userSearchQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

const adjustByAdminSchema = z
  .object({
    userId: z.string().cuid().optional(),
    email: z.string().email().optional(),
    currency: z.nativeEnum(Currency),
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

const ADMIN_PANEL_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Casino Admin Panel</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; background: #0b1220; color: #e5e7eb; }
      h1 { margin: 0 0 16px; }
      .card { background: #111827; border: 1px solid #1f2937; border-radius: 10px; padding: 14px; margin-bottom: 14px; }
      input, select, button { padding: 8px; border-radius: 8px; border: 1px solid #374151; background: #0f172a; color: #e5e7eb; }
      button { cursor: pointer; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border-bottom: 1px solid #1f2937; text-align: left; padding: 8px; vertical-align: top; }
      .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .ok { color: #22c55e; }
      .err { color: #ef4444; white-space: pre-wrap; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    </style>
  </head>
  <body>
    <h1>Admin Panel</h1>
    <div class="card">
      <div class="row">
        <label>Access token:</label>
        <input id="token" style="min-width:520px" placeholder="Paste admin Bearer token" />
        <button id="checkTokenBtn">Verify token</button>
        <button id="logoutBtn">Logout current token</button>
      </div>
      <div id="authStatus" class="mono"></div>
    </div>

    <div class="card">
      <div class="row">
        <label>Search user:</label>
        <input id="query" placeholder="email, id..." />
        <button id="searchBtn">Search</button>
      </div>
      <div id="searchStatus"></div>
      <table id="usersTable">
        <thead>
          <tr><th>User</th><th>Wallets</th><th>Adjust balance</th></tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>

    <script>
      const tokenInput = document.getElementById("token");
      const queryInput = document.getElementById("query");
      const usersTbody = document.querySelector("#usersTable tbody");
      const searchStatus = document.getElementById("searchStatus");
      const authStatus = document.getElementById("authStatus");
      const checkTokenBtn = document.getElementById("checkTokenBtn");

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

      const getErrorMessage = async (res, fallback) => {
        const data = await res.json().catch(() => ({}));
        return (data && data.message) ? data.message : fallback;
      };

      const persistToken = () => {
        try { localStorage.setItem("admin_panel_token", tokenInput.value.trim()); } catch (_e) {}
      };

      const restoreToken = () => {
        try {
          const saved = localStorage.getItem("admin_panel_token");
          if (saved) tokenInput.value = saved;
        } catch (_e) {}
      };

      const renderUsers = (users) => {
        usersTbody.innerHTML = "";
        for (const user of users) {
          const tr = document.createElement("tr");
          const walletLines = (user.wallets || []).map((w) =>
            "<div class=\\"mono\\">" + w.currency + " balance=" + w.balanceAtomic + " locked=" + w.lockedAtomic + "</div>"
          ).join("");
          tr.innerHTML = \`
            <td>
              <div><strong>\${user.email}</strong></div>
              <div class="mono">id=\${user.id}</div>
              <div class="mono">role=\${user.role} status=\${user.status}</div>
            </td>
            <td>\${walletLines || "<span class=\\"mono\\">No wallets</span>"}</td>
            <td>
              <div class="row">
                <select class="currency">
                  <option>BTC</option><option>ETH</option><option>USDT</option><option>USDC</option>
                </select>
                <input class="amount" placeholder="Amount (human)" />
                <button class="credit">+ Credit</button>
                <button class="debit">- Debit</button>
              </div>
              <div class="mono msg"></div>
            </td>
          \`;

          const currencyEl = tr.querySelector(".currency");
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
                  currency: currencyEl.value,
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
              msgEl.textContent = "OK. New balanceAtomic=" + data.balanceAtomic;
              msgEl.className = "mono msg ok";
            } catch (error) {
              msgEl.textContent = error && error.message ? error.message : "Adjustment failed.";
              msgEl.className = "mono msg err";
            }
          };

          tr.querySelector(".credit").addEventListener("click", () => void doAdjust("+"));
          tr.querySelector(".debit").addEventListener("click", () => void doAdjust("-"));
          usersTbody.appendChild(tr);
        }
      };

      document.getElementById("searchBtn").addEventListener("click", async () => {
        try {
          persistToken();
          searchStatus.textContent = "Searching...";
          searchStatus.className = "mono";
          const q = encodeURIComponent(queryInput.value.trim());
          const res = await req("/api/v1/admin/users" + (q ? ("?q=" + q) : ""));
          if (!res.ok) {
            searchStatus.textContent = await getErrorMessage(res, "Search failed");
            searchStatus.className = "err";
            usersTbody.innerHTML = "";
            return;
          }
          const data = await res.json().catch(() => ({ users: [] }));
          searchStatus.textContent = "Found " + data.users.length + " user(s)";
          searchStatus.className = "ok";
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

      tokenInput.addEventListener("change", persistToken);
      restoreToken();
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
      const where = query.q
        ? {
            OR: [{ email: { contains: query.q, mode: "insensitive" as const } }, { id: { equals: query.q } }]
          }
        : {};

      const users = await prisma.user.findMany({
        where,
        orderBy: {
          createdAt: "desc"
        },
        take: query.limit,
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          wallets: {
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

      return reply.send({
        users: users.map((user) => ({
          id: user.id,
          email: user.email,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt,
          wallets: user.wallets.map((wallet) => ({
            id: wallet.id,
            currency: wallet.currency,
            balanceAtomic: wallet.balanceAtomic.toString(),
            lockedAtomic: wallet.lockedAtomic.toString(),
            updatedAt: wallet.updatedAt
          }))
        }))
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
        currency: body.currency,
        amountAtomic: body.amountAtomic,
        reason: body.reason,
        idempotencyKey: request.idempotencyKey,
        metadata: body.metadata,
        referenceId: body.referenceId
      });

      return reply.send({
        targetUserId,
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
