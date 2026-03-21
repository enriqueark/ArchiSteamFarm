#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  DATABASE_URL="postgresql://${PGUSER:-postgres}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}?schema=public"
  export DATABASE_URL
fi

echo "DATABASE_URL: $DATABASE_URL"
echo "Starting migrations..."

# Ejecutar migraciones con el config
npx prisma migrate deploy --config=./prisma.config.mjs

echo "Starting server..."
npm run start
