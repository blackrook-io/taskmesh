#!/usr/bin/env bash
# Deploy current working tree to the local production instance
# (systemd taskmesh on :3000, nginx :80 → HTTPS :443 → Express).
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
  echo "  curl -vk https://127.0.0.1/api/health   # nginx HTTPS (HTTP :80 redirects here)" >&2
  echo "See INSTALL.md §21 Troubleshooting." >&2
  exit 1
}

restart_taskmesh() {
  if sudo -n systemctl restart taskmesh 2>/dev/null; then
    echo "    restarted via sudo systemctl"
    return 0
  fi

  # Non-interactive sudo unavailable: stop the MainPID so Restart=on-failure
  # brings the unit back with the newly built dist/ (SIGKILL is not a "clean" stop).
  local pid
  pid="$(systemctl show taskmesh -p MainPID --value 2>/dev/null || true)"
  if [[ -z "${pid}" || "${pid}" == "0" ]]; then
    fail "cannot restart taskmesh (no sudo; MainPID unknown). Configure passwordless sudo for systemctl restart taskmesh, or run: sudo systemctl restart taskmesh"
  fi

  echo "    sudo unavailable — signaling PID ${pid} (systemd on-failure restart)"
  kill -KILL "${pid}" || fail "failed to signal taskmesh PID ${pid}"

  local i
  for i in $(seq 1 30); do
    if systemctl is-active --quiet taskmesh; then
      local new_pid
      new_pid="$(systemctl show taskmesh -p MainPID --value 2>/dev/null || true)"
      if [[ -n "${new_pid}" && "${new_pid}" != "0" && "${new_pid}" != "${pid}" ]]; then
        return 0
      fi
    fi
    sleep 0.5
  done
  fail "taskmesh did not become active after process signal"
}

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
if git status --porcelain 2>/dev/null | grep -q .; then
  DIRTY="dirty"
else
  DIRTY="clean"
fi

echo "==> TaskMesh deploy to production (nginx :80 → :443)"
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
restart_taskmesh

echo "==> waiting for listen…"
sleep 1

if ! systemctl is-active --quiet taskmesh; then
  fail "taskmesh.service is not active after restart"
fi

echo "==> health check :3000"
curl -fsS http://127.0.0.1:3000/api/health >/dev/null || fail "health check failed on :3000"

echo "==> health check HTTPS :443 (via nginx; -k for self-signed)"
curl -fsSk https://127.0.0.1/api/health >/dev/null || fail "health check failed on https://127.0.0.1/ (nginx)"

echo ""
echo "Deploy OK — $BRANCH @ $SHA ($DIRTY)"
echo "  https://127.0.0.1/          (LAN: https://<server-ip>/ ; HTTP :80 redirects)"
echo "  https://127.0.0.1/api/health"
