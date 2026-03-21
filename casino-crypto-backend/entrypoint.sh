#!/bin/sh
set -e

# If DATABASE_URL is not defined, build it from Railway variables.
if [ -z "$DATABASE_URL" ]; then
  DATABASE_URL="postgresql://${PGUSER:-postgres}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}?schema=public"
  export DATABASE_URL
fi

echo "DATABASE_URL: $DATABASE_URL"
echo "Starting migrations..."

# Ejecutar migraciones con la variable de entorno explícita
DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy

echo "Starting server..."
npm run start
