# Casino Crypto Backend (without games)

Modular **Node.js + TypeScript** backend for a crypto casino platform, designed as a scalable foundation for ~500 concurrent users.

## Stack

- **API**: Fastify 5
- **Language**: strict TypeScript
- **Primary DB**: PostgreSQL + Prisma ORM
- **Cache/coordination**: Redis (distributed rate limit + queues)
- **Queues**: BullMQ (audit events)
- **Auth**: JWT access + refresh with rotation

## Modular architecture

```txt
src/
  app.ts
  server.ts
  config/
    env.ts
  core/
    auth.ts
    errors.ts
    idempotency.ts
  infrastructure/
    db/prisma.ts
    cache/redis.ts
    queue/audit-queue.ts
  modules/
    health/
    auth/
    users/
    wallets/
    ledger/
```

### Included modules (without games)

- `health`: liveness/readiness probes.
- `auth`: register, login, refresh, logout.
- `users`: authenticated profile (`/me`).
- `wallets`: balance and transaction history queries.
- `ledger`: idempotent administrative adjustments (no betting/game logic).

## Scalability decisions (500 concurrent users)

1. **Fastify** for high per-connection throughput.
2. **Redis-backed rate limiting** to sync limits across replicas.
3. **Ledger transaction + row lock (`FOR UPDATE`)** to avoid balance race conditions.
4. **Mandatory Idempotency-Key** for critical operations (`/ledger/admin/adjust`).
5. **Outbox + queue** to decouple audit event processing.
6. **Rotating refresh JWTs** for secure, revocable sessions.

## Core data model (Prisma)

- `User`, `Session`
- `Wallet` (atomic-unit balance with `BigInt`)
- `LedgerEntry` (before/after balance trail)
- `OutboxEvent`
- `Deposit`, `Withdrawal`

## PostgreSQL schema (requested entities)

The Prisma models are mapped to these PostgreSQL tables:

- `users`
- `wallets`
- `wallet_transactions` (via `LedgerEntry`)
- `deposits`
- `withdrawals`

Design highlights for multi-crypto + atomic consistency:

- `wallets`: unique per `(userId, currency)`, balances stored in atomic units (`BIGINT`).
- `wallet_transactions`: idempotency key per wallet, immutable before/after balance trail.
- `deposits` / `withdrawals`: status lifecycle, network info, and optional linkage to ledger rows.
- Composite wallet relation in deposits/withdrawals enforces currency consistency with wallet.
- Extra PostgreSQL `CHECK` constraints available in `prisma/sql/postgresql_atomic_constraints.sql`.

## Requirements

- Node.js 22+
- PostgreSQL 16+
- Redis 7+

## Environment variables

Copy the example file:

```bash
cp .env.example .env
```

Minimum required variables:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`

## Run locally

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

API docs available at `http://localhost:3000/docs`.

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

## Base endpoints

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/users/me`
- `GET /api/v1/wallets`
- `GET /api/v1/wallets/:currency/entries`
- `POST /api/v1/ledger/admin/adjust` (ADMIN only + `Idempotency-Key`)

## Recommended next steps

- Add on-chain/off-chain payments module.
- Integrate KYC/AML and jurisdiction-based limits.
- Add a dedicated worker to process `OutboxEvent`.
- Integrate full observability (OpenTelemetry + Prometheus metrics).
