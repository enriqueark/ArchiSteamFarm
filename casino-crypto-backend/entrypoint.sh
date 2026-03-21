#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  DATABASE_URL="postgresql://${PGUSER:-postgres}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}?schema=public"
  export DATABASE_URL
fi

echo "DATABASE_URL: $DATABASE_URL"
echo "Starting migrations..."

# Ejecutar sin config, Prisma usará schema.prisma + DATABASE_URL
DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy --schema=./prisma/schema.prisma

echo "Starting server..."
npm run start
