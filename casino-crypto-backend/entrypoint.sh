#!/bin/sh
set -e

# If DATABASE_URL is not defined, build it from Railway variables.
if [ -z "$DATABASE_URL" ]; then
  # Railway provides these variables automatically.
  DATABASE_URL="postgresql://${PGUSER:-postgres}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}?schema=public"
  export DATABASE_URL
fi

echo "DATABASE_URL: $DATABASE_URL"
echo "Starting migrations..."

npx prisma migrate deploy --schema ./prisma/schema.prisma

echo "Starting server..."
npm run start
