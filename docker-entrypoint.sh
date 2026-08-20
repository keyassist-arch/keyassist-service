#!/bin/sh
set -e

if [ "$SKIP_MIGRATIONS" = "true" ]; then
  echo "[entrypoint] SKIP_MIGRATIONS=true — skipping migration runner (e.g. first boot against an empty DB, bootstrapped via DATABASE_SYNCHRONIZE instead)"
else
  echo "[entrypoint] Running database migrations..."
  node dist/database/run-migrations.js
fi

echo "[entrypoint] Starting application..."
exec node dist/main.js
