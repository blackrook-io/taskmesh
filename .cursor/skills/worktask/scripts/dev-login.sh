#!/usr/bin/env bash
# Establish a DEV TaskMesh session cookie for /worktask curl I/O.
# Starts `npm run dev` when the DEV API is down.
# Writes: /tmp/tm-dev-cookies.txt (Netscape jar, cookie name taskmesh_session_dev)
#
# Credentials (optional for password path): ~/.config/taskmesh/worktask.env
#   TASKMESH_EMAIL=…
#   TASKMESH_PASSWORD=…
# Optional API key (preferred long-term; no cookie jar):
#   TASKMESH_API_KEY=taskmesh_rw_…
# Optional API base (default http://127.0.0.1:3001):
#   TASKMESH_API_BASE=http://127.0.0.1:3001
#
# Exit 0 on success. Prints "api_key" | "session" | "mint" to stdout as the mode.

set -euo pipefail

CREDS_FILE="${TASKMESH_CREDS_FILE:-$HOME/.config/taskmesh/worktask.env}"
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

if [[ -f "$CREDS_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  # shellcheck source=/dev/null
  source "$CREDS_FILE"
  set +a
fi

BASE="${TASKMESH_API_BASE:-http://127.0.0.1:3001}"
COOKIE_JAR="${TASKMESH_COOKIE_JAR:-/tmp/tm-dev-cookies.txt}"
COOKIE_NAME="taskmesh_session_dev"
export TASKMESH_COOKIE_JAR="$COOKIE_JAR"
export TASKMESH_COOKIE_NAME="$COOKIE_NAME"

ensure_api() {
  if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then
    return 0
  fi
  echo "dev-login: DEV API not responding at $BASE; starting npm run dev" >&2
  (
    cd "$REPO_ROOT"
    nohup npm run dev > /tmp/tm-dev-api.log 2>&1 &
  )
  local i
  for i in $(seq 1 40); do
    if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "dev-login: DEV API did not become healthy at $BASE (see /tmp/tm-dev-api.log)" >&2
  return 1
}

ensure_api

if [[ -n "${TASKMESH_API_KEY:-}" ]]; then
  echo "api_key"
  exit 0
fi

write_jar() {
  local session_id="$1"
  local expires="$2"
  cat >"$COOKIE_JAR" <<EOF
# Netscape HTTP Cookie File
# DEV worktask session (taskmesh_session_dev)
127.0.0.1	FALSE	/	FALSE	${expires}	${COOKIE_NAME}	${session_id}
EOF
  chmod 600 "$COOKIE_JAR" 2>/dev/null || true
}

session_ok() {
  [[ -f "$COOKIE_JAR" ]] || return 1
  local id
  id="$(curl -fsS -b "$COOKIE_JAR" "$BASE/api/v1/auth/session" 2>/dev/null | jq -r '.data.id // empty')"
  [[ -n "$id" ]]
}

if session_ok; then
  echo "session"
  exit 0
fi

# --- Password login ---
if [[ -n "${TASKMESH_EMAIL:-}" && -n "${TASKMESH_PASSWORD:-}" ]]; then
  HDRS="$(mktemp)"
  BODY="$(mktemp)"
  trap 'rm -f "$HDRS" "$BODY"' EXIT
  HTTP_CODE="$(
    curl -sS -D "$HDRS" -o "$BODY" -w '%{http_code}' -X POST "$BASE/api/v1/auth/login" \
      -H 'Content-Type: application/json' \
      -H 'X-TaskMesh-Client: ui' \
      -H "Origin: ${BASE}" \
      -d "$(jq -n --arg e "$TASKMESH_EMAIL" --arg p "$TASKMESH_PASSWORD" '{email:$e,password:$p}')"
  )"
  if [[ "$HTTP_CODE" == "200" ]] && jq -e '.data' "$BODY" >/dev/null 2>&1; then
    RAW="$(tr -d '\r' <"$HDRS" | awk -F': ' 'tolower($1)=="set-cookie"{print $2; exit}')"
    SID="$(printf '%s' "$RAW" | sed -n "s/.*${COOKIE_NAME}=\([^;]*\).*/\1/p")"
    if [[ -n "$SID" ]]; then
      MAX_AGE="$(printf '%s' "$RAW" | sed -n 's/.*Max-Age=\([0-9]*\).*/\1/p')"
      EXPIRES="$(( $(date +%s) + ${MAX_AGE:-604800} ))"
      write_jar "$(printf '%b' "${SID//%/\\x}")" "$EXPIRES" 2>/dev/null || write_jar "$SID" "$EXPIRES"
      if session_ok; then
        echo "session"
        exit 0
      fi
    fi
  fi
fi

# --- Host-local session mint (this DEV host only; not for task row updates) ---
cd "$REPO_ROOT"
node --import tsx <<'EOF'
import "dotenv/config";
import fs from "fs";
import { db, pool } from "./src/db/client.ts";
import { createSession } from "./src/services/auth.ts";
import { eq } from "drizzle-orm";
import * as schema from "./src/db/schema.ts";

const jar = process.env.TASKMESH_COOKIE_JAR || "/tmp/tm-dev-cookies.txt";
const cookieName = process.env.TASKMESH_COOKIE_NAME || "taskmesh_session_dev";
const email = process.env.TASKMESH_EMAIL?.trim();
let userId = 1;
if (email) {
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (row) userId = row.id;
}
const session = await createSession(db, userId);
const expires = Math.floor(new Date(session.expiresAt).getTime() / 1000);
fs.writeFileSync(
  jar,
  `# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t${expires}\t${cookieName}\t${session.id}\n`,
);
fs.chmodSync(jar, 0o600);
await pool.end();
EOF

if session_ok; then
  echo "mint"
  exit 0
fi

echo "dev-login: failed to establish DEV session" >&2
exit 1
