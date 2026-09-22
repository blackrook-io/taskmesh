#!/usr/bin/env bash
# Generate self-signed TLS certs for the Compose nginx proxy (no sudo).
#
# Usage:
#   bash docker/nginx/generate-certs.sh [SAN...]
#
# Default SANs: localhost, 127.0.0.1
# Example:
#   bash docker/nginx/generate-certs.sh localhost 127.0.0.1 192.168.1.50
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIR="${ROOT}/certs"
mkdir -p "$DIR"

if [[ $# -lt 1 ]]; then
  set -- localhost 127.0.0.1
fi

SAN_ARGS=()
for host in "$@"; do
  if [[ "$host" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || [[ "$host" == *:* ]]; then
    SAN_ARGS+=("IP:${host}")
  else
    SAN_ARGS+=("DNS:${host}")
  fi
done
mapfile -t UNIQUE_SANS < <(printf '%s\n' "${SAN_ARGS[@]}" | awk '!seen[$0]++')
SAN_LIST=$(IFS=,; echo "${UNIQUE_SANS[*]}")

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

openssl req -x509 -nodes -newkey rsa:4096 -days 825 \
  -keyout "$TMP/privkey.pem" \
  -out "$TMP/fullchain.pem" \
  -subj "/CN=${1}" \
  -addext "subjectAltName=${SAN_LIST}"

install -m 644 "$TMP/fullchain.pem" "$DIR/fullchain.pem"
install -m 640 "$TMP/privkey.pem" "$DIR/privkey.pem"

echo "Wrote:"
echo "  $DIR/fullchain.pem"
echo "  $DIR/privkey.pem"
echo ""
echo "Start Compose with TLS:"
echo "  docker compose --env-file .env.docker up -d --build"
echo "Then open https://127.0.0.1/ (trust the self-signed cert in the browser)."
