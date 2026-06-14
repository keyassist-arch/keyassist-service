#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
node dist/database/run-migrations.js

echo "[entrypoint] Starting application..."
exec node dist/main.js
