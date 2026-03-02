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
- `wallets`: balances, transaction history, and atomic bet fund reservations.
- `ledger`: idempotent administrative balance adjustments.

## Scalability decisions (500 concurrent users)

1. **Fastify** for high per-connection throughput.
2. **Redis-backed rate limiting** to sync limits across replicas.
3. **Ledger transaction + row lock (`FOR UPDATE`)** to avoid balance race conditions.
4. **Mandatory Idempotency-Key** for critical operations (`/ledger/admin/adjust`).
5. **Outbox + queue** to decouple audit event processing.
6. **Rotating refresh JWTs** for secure, revocable sessions.
7. **Atomic bet reservations** (`hold -> release/capture`) to prevent double spending in concurrent bets.

## Core data model (Prisma)

- `User`, `Session`
- `Wallet` (atomic-unit balance with `BigInt`)
- `LedgerEntry` (before/after balance trail)
- `OutboxEvent`
- `Deposit`, `Withdrawal`
- `BetReservation`

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
- `bet_reservations`: one hold per `(walletId, betReference)` with explicit release/capture lifecycle.
- Composite wallet relation in deposits/withdrawals enforces currency consistency with wallet.
- Extra PostgreSQL `CHECK` constraints available in `prisma/sql/postgresql_atomic_constraints.sql`.

## Atomic wallet flow for concurrent bets

To prevent double spending with simultaneous bets, the wallet module uses a reservation flow:

1. **HOLD**: atomically moves stake from `balanceAtomic` to `lockedAtomic` using one SQL statement:
   - `UPDATE wallets SET balance = balance - x, locked = locked + x WHERE balance >= x`
2. **RELEASE**: unlocks reserved funds (`locked -> balance`) when a bet is cancelled/refunded.
3. **CAPTURE**: finalizes loss by decreasing `lockedAtomic` only.

All three operations run inside PostgreSQL transactions and create immutable records in
`wallet_transactions`, plus state tracking in `bet_reservations`.

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
- `POST /api/v1/wallets/admin/bets/hold` (ADMIN only + `Idempotency-Key`)
- `POST /api/v1/wallets/admin/bets/release` (ADMIN only + `Idempotency-Key`)
- `POST /api/v1/wallets/admin/bets/capture` (ADMIN only + `Idempotency-Key`)

## Recommended next steps

- Add on-chain/off-chain payments module.
- Integrate KYC/AML and jurisdiction-based limits.
- Add a dedicated worker to process `OutboxEvent`.
- Integrate full observability (OpenTelemetry + Prometheus metrics).
