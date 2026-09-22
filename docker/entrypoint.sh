#!/bin/sh
set -eu

# Named volumes mount as root; fix ownership then drop to taskmesh (uid 10001).
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data/uploads /app/data/backups
  chown -R taskmesh:taskmesh /app/data
  exec runuser -u taskmesh -- "$0" "$@"
fi

echo "TaskMesh: applying database migrations…"
node dist/db/migrate.js

echo "TaskMesh: starting API on ${HOST:-0.0.0.0}:${PORT:-3000}…"
exec node dist/index.js
