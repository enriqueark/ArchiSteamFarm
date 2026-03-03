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
    bets/
    users/
    wallets/
    ledger/
    mines/
    roulette/
```

### Included modules (without games)

- `health`: liveness/readiness probes.
- `auth`: register, login, refresh, logout.
- `bets`: generic transactional place/settle flow (backend-only financial logic).
- `users`: authenticated profile (`/me`).
- `wallets`: balances, transaction history, and atomic bet fund reservations.
- `ledger`: idempotent administrative balance adjustments.
- `mines`: provably fair Mines game logic fully generated on backend.
- `roulette`: round-state engine with realtime websocket updates and atomic betting.

## Scalability decisions (500 concurrent users)

1. **Fastify** for high per-connection throughput.
2. **Redis-backed rate limiting** to sync limits across replicas.
3. **Ledger transaction + row lock (`FOR UPDATE`)** to avoid balance race conditions.
4. **Mandatory Idempotency-Key** for critical operations (`/ledger/admin/adjust`).
5. **Outbox + queue** to decouple audit event processing.
6. **Rotating refresh JWTs** for secure, revocable sessions.
7. **Atomic bet reservations** (`hold -> release/capture`) to prevent double spending in concurrent bets.
8. **Provably fair seeds** (`server seed + client seed + nonce`) for reproducible Mines outcomes.
9. **Roulette round lifecycle** (`OPEN -> CLOSED -> SPINNING -> SETTLED`) handled by a background worker.
10. **WebSocket fanout** for low-latency round updates to hundreds of concurrent clients.

## Core data model (Prisma)

- `User`, `Session`
- `Wallet` (atomic-unit balance with `BigInt`)
- `LedgerEntry` (before/after trail + append-only hash chain for tamper evidence)
- `OutboxEvent`
- `Deposit`, `Withdrawal`
- `BetReservation`
- `ProvablyFairProfile`, `ProvablyFairSeed`, `MinesGame`
- `RouletteRound`, `RouletteBet`
- `CasinoBet`

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
- `wallet_transactions`: append-only + tamper-evident (`chainIndex`, `previousHash`, `currentHash`) with DB-enforced immutability.
- `deposits` / `withdrawals`: status lifecycle, network info, and optional linkage to ledger rows.
- `bet_reservations`: one hold per `(walletId, betReference)` with explicit release/capture lifecycle.
- Composite wallet relation in deposits/withdrawals enforces currency consistency with wallet.
- Extra PostgreSQL `CHECK` constraints available in `prisma/sql/postgresql_atomic_constraints.sql`.

## Atomic wallet flow for concurrent bets

To prevent double spending with simultaneous bets, the wallet module uses a reservation flow:

1. **HOLD**: atomically moves stake from `balanceAtomic` to `lockedAtomic` using one SQL statement:
   - via wallet module function `debitBalance()` with `SELECT ... FOR UPDATE` row lock.
2. **RELEASE**: unlocks reserved funds (`locked -> balance`) when a bet is cancelled/refunded.
3. **CAPTURE**: finalizes loss by decreasing `lockedAtomic` only.

All three operations run inside PostgreSQL transactions and create immutable records in
`wallet_transactions`, plus state tracking in `bet_reservations`.

## Generic casino bet transaction flow (SERIALIZABLE)

The `bets` module provides a strict backend-only financial flow:

1. **placeBet**
   - Creates `casino_bets` record in `PENDING`.
   - Debits `balanceAtomic` and increases `lockedAtomic`.
   - Persists game round reference.
   - Persists precomputed `multiplier` from trusted backend game logic.
   - Returns `betId`, `balanceBefore`, `balanceAfter`, `lockedAfter`.

2. **settleBet**
   - Locks bet + wallet rows with `SELECT ... FOR UPDATE`.
   - Requires bet `PENDING`.
   - Recomputes payout internally from `amountAtomic * multiplier`.
   - Never accepts caller-provided payout value.
   - Requires a signed game-result payload verified with Ed25519 public-key cryptography.
   - Allows settlement only for service role `GAME_ENGINE`.
   - Releases locked funds and conditionally pays out winner.
   - Finalizes to `WON` or `LOST` exactly once.

Both phases run with PostgreSQL **SERIALIZABLE isolation level** and retry on serialization conflicts.

## Mines provably fair (backend-only result generation)

The Mines result is **never generated in frontend**.

- Board mine positions are generated in backend using: `serverSeed + clientSeed + nonce`.
- `serverSeedHash` is committed to the player before the game.
- Server seed is revealed only after rotation (and blocked while active Mines games exist).
- With revealed seed, client seed, and nonce, users can verify historical game outcomes.

## Roulette rounds + websocket

- Round states: `OPEN`, `CLOSED`, `SPINNING`, `SETTLED` (and `CANCELLED` for operational fallback).
- New bets are accepted only when round is `OPEN` and `betsCloseAt > now`.
- Bet placement uses SQL-atomic wallet hold (`balanceAtomic -= stake`, `lockedAtomic += stake`) in one transaction.
- On settlement, bets are captured and winners receive payout, both recorded in `wallet_transactions`.
- Websocket endpoint streams round state transitions and stake totals for realtime clients.

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
- `GAME_ENGINE_SERVICE_TOKEN`
- `GAME_ENGINE_PUBLIC_KEY` (Ed25519 public key in PEM or base64 SPKI format)
- `GAME_RESULT_SIGNATURE_MAX_AGE_SECONDS`

Roulette worker settings:

- `ROULETTE_ROUND_OPEN_SECONDS`
- `ROULETTE_CLOSE_TO_SPIN_SECONDS`
- `ROULETTE_SPIN_SECONDS`
- `ROULETTE_WORKER_TICK_MS`

Optional integration test toggle:

- `RUN_DB_TESTS=true`

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
- `POST /api/v1/bets/place` (ADMIN + `Idempotency-Key`)
- `POST /api/v1/bets/:betId/settle` (service role `GAME_ENGINE` + signed payload)
- `GET /api/v1/users/me`
- `GET /api/v1/wallets`
- `GET /api/v1/wallets/:currency/entries`
- `POST /api/v1/ledger/admin/adjust` (ADMIN only + `Idempotency-Key`)
- `POST /api/v1/wallets/admin/bets/hold` (ADMIN only + `Idempotency-Key`)
- `POST /api/v1/wallets/admin/bets/release` (ADMIN only + `Idempotency-Key`)
- `POST /api/v1/wallets/admin/bets/capture` (ADMIN only + `Idempotency-Key`)
- `GET /api/v1/mines/provably-fair`
- `PUT /api/v1/mines/provably-fair/client-seed`
- `POST /api/v1/mines/provably-fair/rotate`
- `POST /api/v1/mines/games` (`Idempotency-Key`)
- `GET /api/v1/mines/games/:gameId`
- `POST /api/v1/mines/games/:gameId/reveal`
- `POST /api/v1/mines/games/:gameId/cashout` (`Idempotency-Key`)
- `GET /api/v1/roulette/rounds/current?currency=USDT`
- `GET /api/v1/roulette/rounds/:roundId`
- `POST /api/v1/roulette/bets` (`Idempotency-Key`)
- `GET /api/v1/roulette/bets/me`
- `WS /api/v1/roulette/ws?currency=USDT`

## Recommended next steps

- Add on-chain/off-chain payments module.
- Integrate KYC/AML and jurisdiction-based limits.
- Add a dedicated worker to process `OutboxEvent`.
- Integrate full observability (OpenTelemetry + Prometheus metrics).
