#!/bin/sh
set -eu

echo "TaskMesh: applying database migrations…"
node dist/db/migrate.js

echo "TaskMesh: starting API on ${HOST:-0.0.0.0}:${PORT:-3000}…"
exec node dist/index.js
