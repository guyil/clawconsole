#!/bin/sh
set -e

echo "==> Running database migrations..."
node --import tsx/esm node_modules/.bin/knex migrate:latest --knexfile knexfile.ts
echo "==> Migrations complete."

echo "==> Starting ClawConsole backend..."
exec node dist/server.js
