#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  DATABASE_URL="postgresql://${PGUSER:-postgres}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}?schema=public"
  export DATABASE_URL
fi

echo "DATABASE_URL: $DATABASE_URL"
echo "Starting migrations..."

# Ejecutar migraciones usando config Prisma 7
DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy --config=./prisma.config.ts

echo "Starting server..."
npm run start
