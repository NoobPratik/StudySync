#!/bin/sh
set -e

echo "[StudySync] Syncing PostgreSQL schema with Prisma..."
MAX_TRIES=20
COUNT=0
until node /app/prisma-cli/node_modules/prisma/build/index.js db push --config /app/prisma.config.ts --schema /app/prisma/schema.prisma; do
  COUNT=$((COUNT + 1))
  if [ "$COUNT" -ge "$MAX_TRIES" ]; then
    echo "[StudySync] ERROR: Database schema sync failed after $MAX_TRIES attempts."
    exit 1
  fi
  echo "[StudySync] Waiting for PostgreSQL to accept connections ($COUNT/$MAX_TRIES)..."
  sleep 2
done

mkdir -p "${UPLOAD_DIR:-/app/uploads}"
echo "[StudySync] Starting production server on port ${PORT:-3000}..."
exec node /app/server.js
