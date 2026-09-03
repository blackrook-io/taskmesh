#!/usr/bin/env bash
# One-shot PROD task grooming: T0095 auth epic split + dependency rewrite.
set -euo pipefail
BASE="${TASKMESH_API_BASE:-http://127.0.0.1:3000}"
PROJECT_ID=4

api() {
  local method="$1" path="$2"
  shift 2
  curl -fsS -X "$method" "${BASE}${path}" \
    -H 'Content-Type: application/json' \
    "${@}" 
}

post_comment() {
  local task_id="$1" body="$2"
  api POST "/api/v1/tasks/${task_id}/activity" \
    -d "$(jq -n --arg body "$body" '{body:$body}')" >/dev/null
}

create_task() {
  local title="$1" description="$2" parent_id="${3:-}" state="${4:-ready}" priority="${5:-urgent}"
  local payload
  payload=$(jq -n \
    --arg title "$title" \
    --arg description "$description" \
    --arg state "$state" \
    --arg priority "$priority" \
    --argjson parent_id "${parent_id:-null}" \
    '{title:$title, description:$description, state:$state, priority:$priority, parentId:$parent_id}')
  api POST "/api/v1/projects/${PROJECT_ID}/tasks" -d "$payload" | jq '.data | {id, number, title, parentId}'
}

patch_task() {
  local task_id="$1" payload="$2"
  api PATCH "/api/v1/tasks/${task_id}" -d "$payload" | jq '.data | {id, number, title, state, parentId}'
}

add_dep() {
  local task_id="$1" depends_on="$2"
  api POST "/api/v1/tasks/${task_id}/dependencies" \
    -d "$(jq -n --argjson d "$depends_on" '{dependsOnTaskId:$d}')" >/dev/null
}

remove_dep() {
  local task_id="$1" depends_on="$2"
  curl -fsS -X DELETE "${BASE}/api/v1/tasks/${task_id}/dependencies/${depends_on}" >/dev/null
}

echo "=== Health ==="
api GET /api/health | jq -r '.ok'

T0095_ID=107
T0096_ID=108
T0084_ID=96
T0087_ID=99

echo "=== Create child tasks under T0095 ==="

read -r -d '' T0107_DESC <<'EOF' || true
**Child of T0095.** First slice of multi-user: real user accounts admins can manage before login UI ships.

## Scope

- **Admin → Users:** Create user (display name, **required** email, **required** initial password using existing password rules).
- **Admin → Users:** Delete user with confirmation (block deleting the last remaining user; block deleting self while logged in as that user once auth exists).
- **Admin → Users:** **Lock** / **Unlock** account (sets/clears `locked_at`; distinct from Deactivate).
- Deactivated users remain as today (T0064); login/auth tasks must reject **both** locked and deactivated accounts.
- Ensure new users get the next `U####` reference id.

## Non-goals (sibling Tasks)

- Login UI / sessions (T0096)
- API route protection (T0084)
- Roles / hiding Administration (T0108)
- Password history (T0109)
- Per-user record ownership (T0110)

## Acceptance

- Admin can create a second user with email + password, lock/unlock them, and delete them (with guards).
- Locked and deactivated states are visible in the Users table.
EOF

T0107=$(create_task "User accounts — create, delete, lock/unlock" "$T0107_DESC" "$T0095_ID" ready urgent)
T0107_ID=$(echo "$T0107" | jq -r '.id')
echo "T0107 id=$T0107_ID"

read -r -d '' T0108_DESC <<'EOF' || true
**Child of T0095.** Role framework and Administration gating for multi-user.

## Scope

- Introduce **Roles** (start with **Administrator**; seed U0001 as Administrator).
- Administrators can assign/remove Roles on users (except cannot remove the last Administrator).
- Administrators can create/delete custom Roles (Administrator role is system-protected).
- **Non-administrators** cannot see Administration nav, modals, or `/admin/*` routes; server returns 403 on admin APIs.
- Non-admins use Settings → Profile for **their own** user record only.

## Depends on

T0107 (user accounts exist).

## Non-goals

- OIDC / federation (T0111)
- API keys enforcement (T0063)
EOF

T0108=$(create_task "Roles and Administration access control" "$T0108_DESC" "$T0095_ID" ready urgent)
T0108_ID=$(echo "$T0108" | jq -r '.id')

read -r -d '' T0109_DESC <<'EOF' || true
**Child of T0095.** Self-service password reset history (T0062 Profile UX exists; add server enforcement).

## Scope

- Store last **5** password hashes (or equivalent) per user.
- Profile → Password change rejects reuse of any of the last 5 passwords.
- Admin reset-password may bypass history (document in UI) or optionally still enforce — pick bypass for admin recovery.

## Depends on

T0107 (multiple users / account model stable).
EOF

T0109=$(create_task "Password history on Profile reset" "$T0109_DESC" "$T0095_ID" ready medium)
T0109_ID=$(echo "$T0109" | jq -r '.id')

read -r -d '' T0110_DESC <<'EOF' || true
**Child of T0095.** Per-user ownership of domain records once auth exists.

## Scope

- New records (Tasks, Projects, Ideas, boards, documents, etc.) are owned by the authenticated user (`createdById` / future owner fields as needed).
- Users see and mutate **only their own** records unless Administrator.
- Administrators retain full visibility (Administration + all data) for support/ops.
- Migration/backfill: existing rows remain attributed to U0001; no destructive data move required in MVP.

## Depends on

T0108 (roles — need Administrator bypass vs normal user scope).
EOF

T0110=$(create_task "Per-user record ownership" "$T0110_DESC" "$T0095_ID" ready high)
T0110_ID=$(echo "$T0110" | jq -r '.id')

read -r -d '' T0111_DESC <<'EOF' || true
**Grandchild of T0095 (child of T0084).** Deferred federation — not required for email/password MVP.

## Scope (future)

- External identity providers via OpenID Connect / OAuth 2.0.
- Optional link/unlink provider to existing TaskMesh user.
- MFA, passkeys, forgot-password, forgot-username flows as separate future Tasks.

## Depends on

T0084 (local sessions and API binding must exist first).

## State

Draft until local auth MVP ships.
EOF

T0111=$(create_task "OIDC / external identity federation" "$T0111_DESC" "$T0084_ID" new low)
T0111_ID=$(echo "$T0111" | jq -r '.id')

echo "=== Child deps ==="
add_dep "$T0108_ID" "$T0107_ID"
add_dep "$T0109_ID" "$T0107_ID"
add_dep "$T0110_ID" "$T0108_ID"
add_dep "$T0111_ID" "$T0084_ID"

echo "=== Reparent existing auth Tasks under T0095 ==="
patch_task "$T0096_ID" "$(jq -n --argjson p "$T0095_ID" '{parentId:$p}')"
patch_task "$T0084_ID" "$(jq -n --argjson p "$T0095_ID" '{parentId:$p}')"
patch_task "$T0087_ID" "$(jq -n --argjson p "$T0084_ID" '{parentId:$p}')"

echo "=== Rewrite T0095 parent epic ==="
read -r -d '' T0095_DESC <<EOF || true
Parent epic for **multi-user** TaskMesh: accounts, login, sessions, roles, and ownership.

## Implementation order (critical path)

1. **T0107** — User accounts (create / delete / lock-unlock)
2. **T0096** — Login screen + local session + SPA gate
3. **T0084** — Bind API routes to authenticated session user
4. **T0108** — Roles + Administration gating (can start after T0107; parallel with T0096/T0084)
5. **T0109** — Password history (after T0107)
6. **T0110** — Per-user record ownership (after T0108)
7. **T0087** — Public-internet / cookie hardening (after T0084)
8. **T0063** — API keys (after T0084 + T0087)
9. **T0111** — OIDC / federation (deferred)

## Child Tasks

| Task | Title |
|------|-------|
| T0107 | User accounts — create, delete, lock/unlock |
| T0096 | Implement User Login screen |
| T0084 | Authentication and session binding |
| T0108 | Roles and Administration access control |
| T0109 | Password history on Profile reset |
| T0110 | Per-user record ownership |

**Grandchild:** T0111 (under T0084) — OIDC / external identity federation.

## Parent completion

This parent Task completes when all **non-deferred** children above are **Complete** (T0111 may remain Draft/canceled without blocking).

## Original vision (unchanged)

Multiple users via email/password; Administrators manage users; MFA and federation later.
EOF

patch_task "$T0095_ID" "$(jq -n --arg d "$T0095_DESC" '{description:$d, state:"ready", priority:"urgent"}')"

echo "=== Rewrite T0096 ==="
read -r -d '' T0096_DESC <<'EOF' || true
**Child of T0095.** Login UI and **local email/password session** for the SPA. This Task owns sessions; T0084 binds APIs to them.

## UI

- Standalone **Login** page: TaskMesh title + `MeshMark` logo, default system theme colors (`GET /api/v1/config`).
- Fields: **Email**, **Password** (masked).
- Submit → authenticate; on success route into the main app; on failure show a **single generic** message (do not reveal whether email exists).
- **Logout** control (shell/settings) clears session and returns to Login.

## Server

- `POST /api/v1/auth/login` — email + password; verify with existing scrypt helpers.
- **Reject** when: user/email not found, password mismatch, **`locked_at` set**, or **`deactivated_at` set** (same user-facing error).
- On success: create **httpOnly** session cookie (secure in production); set `last_login_at`; reset `failed_login_count`.
- On failure: increment `failed_login_count`; when count ≥ **`login_failure_threshold`** system property, set `locked_at` (timed cooldown unlock is a later Task).
- `POST /api/v1/auth/logout` — destroy session.
- `GET /api/v1/auth/session` (or equivalent) — current user for SPA bootstrap.
- SPA **gate**: unauthenticated browser clients redirect to Login (API may return 401 JSON for XHR).

## System Properties (Administration → System Properties)

Add/store now; enforcement noted where deferred:

| Key | UI label | Default | Enforced in this Task |
|-----|----------|---------|------------------------|
| `session_timeout_minutes` | Session timeout (minutes) | **60** | **No** — stored for later middleware |
| `login_failure_threshold` | Login attempts before lockout | **3** (change default from 5) | **Yes** — lock account at threshold |

Recommend documenting both in Admin UI help text.

## Explicit non-goals (later Tasks)

- MFA, passkeys, forgot/reset password, forgot username (T0111+)
- Session timeout **enforcement** (uses `session_timeout_minutes` later)
- Timed auto-unlock after lockout cooldown
- API key auth (T0063)
- Full route-level authorization / roles (T0108) — login only establishes identity
- OIDC (T0111)

## Depends on

**T0107** — at least two manageable user accounts with email/password and lock/unlock.

## Acceptance

- Valid credentials → main UI; invalid/locked/deactivated → generic error on Login page.
- Logout works; refresh requires login again.
- Lockout after configured failed attempts.
EOF

patch_task "$T0096_ID" "$(jq -n --arg d "$T0096_DESC" '{description:$d, state:"ready", priority:"high"}')"

echo "=== Rewrite T0084 ==="
read -r -d '' T0084_DESC <<'EOF' || true
**Child of T0095.** Bind the HTTP API to the **local session** created by T0096. OIDC/federation moves to **T0111**.

Spawned from [T0073 Secure inputs](/tasks?open=85).

## Scope

- Auth middleware: resolve current user from session cookie (T0096) on `/api/v1/*` (except login/logout/public config/health/static).
- `GET /api/v1/users/me` returns the **session** user (replace hardcoded user-1 stub).
- Mutating routes record `updatedById` / actors from session user.
- Update `last_login_at` on successful login (if not already in T0096).
- Log auth failures to `api_request_logs` where appropriate.
- Keep hooks ready for API keys as a second auth path (T0063) — design middleware chain accordingly.

## Non-goals

- OIDC / OAuth / passkeys (**T0111**)
- MFA
- Rate limiting (**T0085**)
- CSRF / cookie hardening beyond basics (**T0087**)
- Roles / admin 403 rules (**T0108**)
- Per-user data scoping (**T0110**)

## Depends on

**T0096** — login screen and session cookie must exist.

## Acceptance

- Unauthenticated API calls to protected routes return 401.
- Authenticated SPA usage works end-to-end with session from Login.
- SECURITY.md threat model updated to reflect authenticated API (residual risks → T0087/T0063).
EOF

patch_task "$T0084_ID" "$(jq -n --arg d "$T0084_DESC" '{description:$d, state:"ready", priority:"urgent"}')"

echo "=== Touch T0087 grandchild description ==="
read -r -d '' T0087_DESC <<'EOF' || true
**Grandchild of T0095 (child of T0084).** Hardening before public internet exposure.

Spawned from [T0073 Secure inputs](/tasks?open=85).

After **T0084** sessions exist:

- TLS/nginx review
- CSRF protection for cookie-based session auth
- Least-privilege OS/DB roles
- Secrets handling
- Second-pass CSP (external images, Excalidraw wasm)

See SECURITY.md residual risks.

## Depends on

**T0084** (authenticated sessions).
EOF

patch_task "$T0087_ID" "$(jq -n --arg d "$T0087_DESC" '{description:$d, state:"ready", priority:"urgent"}')"

echo "=== Rewrite dependencies ==="
remove_dep "$T0096_ID" "$T0095_ID"
remove_dep "$T0084_ID" "$T0095_ID"
remove_dep "$T0087_ID" "$T0095_ID"

add_dep "$T0096_ID" "$T0107_ID"
add_dep "$T0084_ID" "$T0096_ID"
# T0087 already depended on T0095; now depends T0084 only
add_dep "$T0087_ID" "$T0084_ID"

echo "=== Summary comment on T0095 ==="
post_comment "$T0095_ID" "**Auth epic restructured**

Split T0095 into implementable child Tasks and fixed the T0084 ↔ T0096 ordering:

**New children:** T0107 (accounts), T0108 (roles), T0109 (password history), T0110 (ownership)

**Reparented:** T0096, T0084 → children of T0095; T0087 → child of T0084

**New deferred grandchild:** T0111 OIDC/federation under T0084

**Critical path:** T0107 → T0096 → T0084 → T0087 → T0063

T0096 marked **Ready** (blocked by T0107 until that ships). T0084 description no longer specifies OIDC for MVP."

echo "=== Final dependency graph ==="
for id in $T0095_ID $T0107_ID $T0108_ID $T0109_ID $T0110_ID $T0096_ID $T0084_ID $T0087_ID $T0111_ID; do
  n=$(api GET "/api/v1/tasks/$id" | jq -r '.data | "T\(.number|tostring|if length<4 then "0"*(4-length) + . else . end) \(.title)"')
  deps=$(api GET "/api/v1/tasks/$id/dependencies" | jq -r '[.data.dependsOn[] | "T\(.number)"] | join(", ")')
  parent=$(api GET "/api/v1/tasks/$id" | jq -r '.data.parentId')
  echo "$n | parent=$parent | depends: ${deps:-none}"
done

echo "Done."
