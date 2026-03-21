#!/bin/sh
set -e

echo "DATABASE_URL: $DATABASE_URL"
echo "Starting migrations..."

npx prisma migrate deploy --schema ./prisma/schema.prisma

echo "Starting server..."
npm run start
