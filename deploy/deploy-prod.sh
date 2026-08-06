#!/usr/bin/env bash
# Deploy current working tree to the local production instance
# (systemd taskmesh on :3000, nginx on :80).
#
# Usage:
#   npm run deploy:prod
#   npm run deploy:prod -- --skip-install
#   npm run deploy:prod -- --skip-migrate
#   bash deploy/deploy-prod.sh [--skip-install] [--skip-migrate]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SKIP_INSTALL=0
SKIP_MIGRATE=0

for arg in "$@"; do
  case "$arg" in
    --skip-install) SKIP_INSTALL=1 ;;
    --skip-migrate) SKIP_MIGRATE=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--skip-install] [--skip-migrate]" >&2
      exit 2
      ;;
  esac
done

fail() {
  echo "" >&2
  echo "Deploy failed: $*" >&2
  echo "Hints:" >&2
  echo "  sudo systemctl status taskmesh --no-pager" >&2
  echo "  journalctl -u taskmesh -n 50 --no-pager" >&2
  echo "  curl -v http://127.0.0.1:3000/api/health" >&2
  echo "  curl -v http://127.0.0.1/api/health   # nginx :80 → Express" >&2
  echo "See INSTALL.md §21 Troubleshooting." >&2
  exit 1
}

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
if git status --porcelain 2>/dev/null | grep -q .; then
  DIRTY="dirty"
else
  DIRTY="clean"
fi

echo "==> TaskMesh deploy to production (:80)"
echo "    root:   $ROOT"
echo "    git:    $BRANCH @ $SHA ($DIRTY)"
echo "    flags:  skip-install=$SKIP_INSTALL skip-migrate=$SKIP_MIGRATE"
echo ""

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  echo "==> npm install (root)"
  npm install || fail "npm install (root) failed"

  echo "==> npm install (client)"
  npm install --prefix client || fail "npm install (client) failed"
else
  echo "==> skipping npm install (--skip-install)"
fi

if [[ "$SKIP_MIGRATE" -eq 0 ]]; then
  echo "==> db:migrate"
  npm run db:migrate || fail "db:migrate failed"
else
  echo "==> skipping db:migrate (--skip-migrate)"
fi

echo "==> build:all"
npm run build:all || fail "build:all failed"

echo "==> restart taskmesh.service"
sudo systemctl restart taskmesh || fail "systemctl restart taskmesh failed"

echo "==> waiting for process…"
sleep 2

if ! systemctl is-active --quiet taskmesh; then
  fail "taskmesh.service is not active after restart"
fi

echo "==> health check :3000"
curl -fsS http://127.0.0.1:3000/api/health >/dev/null || fail "health check failed on :3000"

echo "==> health check :80 (nginx)"
curl -fsS http://127.0.0.1/api/health >/dev/null || fail "health check failed on :80 (nginx)"

echo ""
echo "Deploy OK — $BRANCH @ $SHA ($DIRTY)"
echo "  http://127.0.0.1/          (LAN: http://<server-ip>/)"
echo "  http://127.0.0.1/api/health"
