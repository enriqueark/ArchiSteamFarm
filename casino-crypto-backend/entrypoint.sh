#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  DATABASE_URL="postgresql://${PGUSER:-postgres}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}?schema=public"
  export DATABASE_URL
fi

echo "DATABASE_URL: $DATABASE_URL"
echo "Starting migrations..."

# Recover from previously failed migration attempt (safe no-op when absent).
DATABASE_URL="$DATABASE_URL" npx prisma migrate resolve --rolled-back 20260303114500_financial_invariants --config=./prisma.config.ts >/dev/null 2>&1 || true

# Ejecutar migraciones usando config Prisma 7
DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy --config=./prisma.config.ts

echo "Starting server..."
npm run start
