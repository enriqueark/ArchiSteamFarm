# Casino Crypto Backend (sin juegos)

Backend modular en **Node.js + TypeScript** para una plataforma de casino crypto, diseñado como base escalable para ~500 usuarios concurrentes.

## Stack

- **API**: Fastify 5
- **Lenguaje**: TypeScript estricto
- **DB principal**: PostgreSQL + Prisma ORM
- **Cache/coordination**: Redis (rate limit distribuido + colas)
- **Colas**: BullMQ (eventos de auditoría)
- **Auth**: JWT access + refresh con rotación

## Arquitectura modular

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

### Módulos incluidos (sin juegos)

- `health`: probes de liveness/readiness.
- `auth`: registro, login, refresh, logout.
- `users`: perfil autenticado (`/me`).
- `wallets`: consulta de balances y movimientos.
- `ledger`: ajustes administrativos con idempotencia (sin lógica de apuestas/juegos).

## Decisiones de escalabilidad (500 concurrentes)

1. **Fastify** para alto rendimiento por conexión.
2. **Rate limiting con Redis** para sincronizar límites entre réplicas.
3. **Ledger con transacción SQL + row lock (`FOR UPDATE`)** para evitar race conditions en balances.
4. **Idempotency-Key** obligatorio en operaciones críticas (`/ledger/admin/adjust`).
5. **Outbox + cola** para desacoplar eventos de auditoría.
6. **JWT con refresh rotatorio** para sesiones seguras y revocables.

## Modelo de datos principal (Prisma)

- `User`, `Session`
- `Wallet` (saldo en unidades atómicas `BigInt`)
- `LedgerEntry` (doble rastro de before/after)
- `OutboxEvent`

## Requisitos

- Node.js 22+
- PostgreSQL 16+
- Redis 7+

## Variables de entorno

Copiar el ejemplo:

```bash
cp .env.example .env
```

Variables mínimas:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`

## Ejecutar en local

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

API docs en `http://localhost:3000/docs`.

## Ejecutar con Docker

```bash
cp .env.example .env
docker compose up --build
```

## Endpoints base

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/users/me`
- `GET /api/v1/wallets`
- `GET /api/v1/wallets/:currency/entries`
- `POST /api/v1/ledger/admin/adjust` (solo ADMIN + `Idempotency-Key`)

## Siguientes pasos recomendados

- Agregar módulo de pagos on-chain/off-chain.
- Integrar KYC/AML y límites por jurisdicción.
- Añadir worker dedicado para procesar `OutboxEvent`.
- Integrar observabilidad completa (OpenTelemetry + métricas Prometheus).
