#!/usr/bin/env bash
# Generate a self-signed TLS cert for TaskMesh nginx (LAN / lab use).
#
# Usage:
#   sudo bash deploy/ssl/generate-self-signed.sh [SAN...]
#
# Example:
#   sudo bash deploy/ssl/generate-self-signed.sh 192.168.1.50 localhost 127.0.0.1
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (sudo) so files can be written under /etc/nginx/ssl/taskmesh/" >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <lan-ip-or-hostname> [extra-SAN...]" >&2
  exit 2
fi

DIR="/etc/nginx/ssl/taskmesh"
mkdir -p "$DIR"

SAN_ARGS=()
for host in "$@"; do
  if [[ "$host" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || [[ "$host" == *:* ]]; then
    SAN_ARGS+=("IP:${host}")
  else
    SAN_ARGS+=("DNS:${host}")
  fi
done
# de-dupe while preserving order
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
echo "Reload nginx after updating the site config:"
echo "  sudo nginx -t && sudo systemctl reload nginx"
