# /worktask API reference (PROD)

Base URL: `http://127.0.0.1:3000`

Confirm health first:

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

## Auth (required)

PROD `/api/v1/*` (except health / login / logout / session bootstrap / public theme) needs auth. Establish it **before** any task I/O.

### Prefer the helper

```bash
# From repo root
.cursor/skills/worktask/scripts/prod-login.sh
# → prints: api_key | session | mint
# → session/mint write cookie jar: /tmp/tm-prod-cookies.txt
```

Reuse that jar for the rest of the session. Re-run the helper (or re-check session) if a call returns 401.

### Credentials file (password path)

Path: `~/.config/taskmesh/worktask.env` (mode `600`, outside the repo — never commit).

```bash
mkdir -p ~/.config/taskmesh
cat > ~/.config/taskmesh/worktask.env <<'EOF'
TASKMESH_EMAIL=you@example.com
TASKMESH_PASSWORD=…
# Optional long-term alternative (skips cookie + CSRF):
# TASKMESH_API_KEY=taskmesh_rw_…
EOF
chmod 600 ~/.config/taskmesh/worktask.env
```

If the file is missing at `/worktask` start: **ask the user once**, write it, then continue. Do **not** hardcode passwords into the skill, plans, comments, or shell history paste in docs.

### API key path (optional)

If `TASKMESH_API_KEY` is set (env or creds file), use it on every call and skip the cookie jar / CSRF headers:

```bash
curl -fsS -H "Authorization: Bearer ${TASKMESH_API_KEY}" \
  'http://127.0.0.1:3000/api/v1/tasks'
```

Read-write keys only for mutating worktask calls. Create a key in the app (Profile / Admin) if needed.

### Session cookie path (default)

Cookie jar: `/tmp/tm-prod-cookies.txt`  
Cookie name for PROD: **`taskmesh_session`** (not `taskmesh_session_dev`).

```bash
COOKIE=/tmp/tm-prod-cookies.txt
BASE=http://127.0.0.1:3000

# Login (Secure Set-Cookie may not land in curl’s jar over http:// — helper parses it)
curl -sS -D /tmp/tm-login.hdrs -o /tmp/tm-login.json -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -H 'X-TaskMesh-Client: ui' \
  -H 'Origin: http://127.0.0.1:3000' \
  -d "$(jq -n --arg e "$TASKMESH_EMAIL" --arg p "$TASKMESH_PASSWORD" '{email:$e,password:$p}')"

# Verify
curl -fsS -b "$COOKIE" "$BASE/api/v1/auth/session" | jq '.data.email'
```

**CSRF (session only):** every mutating request (`POST`/`PATCH`/`PUT`/`DELETE`) must send:

- `-b "$COOKIE"` (and `-c "$COOKIE"` if refreshing)
- `-H 'X-TaskMesh-Client: ui'`
- `-H 'Origin: http://127.0.0.1:3000'`

GETs only need the cookie (or Bearer key).

### Session mint fallback (app host only)

If password login fails and no API key is set, mint a DB session for the creds-file user (or user id `1`) and write a Netscape jar with cookie name `taskmesh_session`. Prefer `.cursor/skills/worktask/scripts/prod-login.sh`. Manual shape:

```bash
cd /srv/taskmesh && node --import tsx <<'EOF'
import "dotenv/config";
import fs from "fs";
import { db, pool } from "./src/db/client.ts";
import { createSession } from "./src/services/auth.ts";
const session = await createSession(db, 1);
const expires = Math.floor(new Date(session.expiresAt).getTime() / 1000);
fs.writeFileSync(
  "/tmp/tm-prod-cookies.txt",
  `# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t${expires}\ttaskmesh_session\t${session.id}\n`,
);
await pool.end();
EOF
```

Use this **only** for auth bootstrap on the app host — not for reading/updating task rows via SQL.

### Curl aliases used below

```bash
COOKIE=/tmp/tm-prod-cookies.txt
BASE=http://127.0.0.1:3000
# Session auth:
AUTH=(-b "$COOKIE")
MUTATE=(-b "$COOKIE" -H 'Content-Type: application/json' -H 'X-TaskMesh-Client: ui' -H 'Origin: http://127.0.0.1:3000')
# Or API key instead:
# AUTH=(-H "Authorization: Bearer ${TASKMESH_API_KEY}")
# MUTATE=(-H "Authorization: Bearer ${TASKMESH_API_KEY}" -H 'Content-Type: application/json')
```

## Resolve Task Number → record

Display number `T0036` → integer `36`. List tasks and match `number` (not `id`):

```bash
curl -fsS "${AUTH[@]}" "$BASE/api/v1/tasks" \
  | jq --argjson n 36 '.data[] | select(.number == $n)'
```

Then load by primary key:

```bash
TASK_ID=…   # from previous .id
curl -fsS "${AUTH[@]}" "$BASE/api/v1/tasks/${TASK_ID}"
curl -fsS "${AUTH[@]}" "$BASE/api/v1/tasks/${TASK_ID}/activity"
curl -fsS "${AUTH[@]}" "$BASE/api/v1/tasks/${TASK_ID}/dependencies"
```

If the task row has `parentId` (Child Task), load the Parent the same way (`GET /api/v1/tasks/{parentId}` and its `/activity`). If you need more context or information on a Child Task, refer to the Parent.

## Dependencies (Depends on / Required by)

```bash
# List both directions
curl -fsS "${AUTH[@]}" "$BASE/api/v1/tasks/${TASK_ID}/dependencies"
# → { data: { dependsOn: [{id,number,title,state}], requiredBy: [...] } }

# Search candidates (title OR number)
curl -fsS "${AUTH[@]}" \
  "$BASE/api/v1/tasks/dependency-search?q=T0042&excludeTaskId=${TASK_ID}"
```

**Worktask Depends-on gate:** if any `dependsOn[].state` is not `complete`, `canceled`, or `pending`, alert and stop before planning/branch/In Progress. `pending` means the dependency’s own work is done (waiting on *its* children) and does not block.

### Add a dependency (relate tasks)

```bash
# New follow-up Task depends on the working Task (typical deferral link)
curl -fsS -X POST "$BASE/api/v1/tasks/${NEW_TASK_ID}/dependencies" \
  "${MUTATE[@]}" \
  -d "{\"dependsOnTaskId\": ${WORKING_TASK_ID}}"
```

### Deferred scope → new Task (interview / sizing)

When `/worktask` defers scope out of the current Task:

1. Prefer `POST /api/v1/projects/{projectId}/tasks` (same project as the working Task) with a full description (context, acceptance, why deferred from `T####`). Use `state: "new"` unless the user wants Ready. Auth: session cookie + CSRF headers, or Bearer API key.
2. Relate: usually new Task **Depends on** the working Task (`POST …/dependencies` as above).
3. Record the new `T####` in the plan and comments — do not leave deferrals only as plan bullets.

## Update state

```bash
curl -fsS -X PATCH "$BASE/api/v1/tasks/${TASK_ID}" \
  "${MUTATE[@]}" \
  -d '{"state":"in_progress"}'
```

Finish:

```bash
curl -fsS -X PATCH "$BASE/api/v1/tasks/${TASK_ID}" \
  "${MUTATE[@]}" \
  -d '{"state":"complete"}'
```

If unfinished direct children remain, the API stores `pending` instead of `complete`. Finishing the last child auto-completes a Pending parent — do not PATCH the parent yourself.

Do **not** send `dueDate` from this skill.

## Comments

```bash
curl -fsS -X POST "$BASE/api/v1/tasks/${TASK_ID}/activity" \
  "${MUTATE[@]}" \
  -d "$(jq -n --arg body "$BODY" '{body:$body}')"
```

### Start comment template

```markdown
**Worktask started**

- Branch: `T0036-example-slug`
- Plan: `.cursor/plans/2026-08-T0036-example-slug.mdc`

<summary of approach in a few bullets>
```

### QA follow-up comment template

Post when implementing new functionality or corrections during QA (not only at Complete):

```markdown
**QA follow-up**

- Plan updated: `.cursor/plans/2026-08-T0036-example-slug.mdc` (QA follow-ups section)

<summary of additions / corrections from QA>
```

### Finish comment template

```markdown
**Worktask completed**

- Merged branch `T0036-example-slug` → `main`
- Plan archived: `.cursor/plans/executed/2026-08-T0036-example-slug.mdc`
- Deployed to PROD (health checks OK)
- App version: `0.22.1` (example)
- Release notes: `RELEASE_NOTES.md` updated for `0.22.1`

<summary of what shipped>

**QA follow-ups** (omit section if none)

- <each addition or correction from QA>
```

## States

| API value | UI label |
|-----------|----------|
| `new` | Draft |
| `ready` | Ready |
| `in_progress` | In Progress |
| `pending` | Pending |
| `complete` | Complete |
| `canceled` | Canceled |
| `on_hold` | On Hold |

Fresh `/worktask` starts expect `ready`. Draft (`new`) triggers the state gate (alert and wait).

## Context fields to read

From the task row: `id`, `number`, `title`, `description`, `state`, `priority`, `projectId`, `phaseId`, `parentId`.

From activity: all `kind: "comment"` bodies (chronological); skim `kind: "change"` for prior state/priority edits.

From dependencies: `dependsOn` / `requiredBy` summaries (`id`, `number`, `title`, `state`) — used for the Depends-on gate at sizing.

**Parent / Child:** `parentId != null` means this is a Child. If the Agent needs more context or information on a Child Task, it should refer to the Parent (load Parent title, description, comments). Parent context supplements the Child; it does not replace Child-specific acceptance notes.

## Git ops (this host)

**Never** run `git config` to set identity.

If `git commit` fails with “Author identity unknown”, prefix that commit only:

```bash
GIT_AUTHOR_NAME='Rook' \
GIT_AUTHOR_EMAIL='166227646+blackrook-io@users.noreply.github.com' \
GIT_COMMITTER_NAME='Rook' \
GIT_COMMITTER_EMAIL='166227646+blackrook-io@users.noreply.github.com' \
git commit -m "$(cat <<'EOF'
Message here.
EOF
)"
```

(Match name/email to recent `git log` authors in this repo.)

**Push:** `origin` may be HTTPS without credentials. Prefer:

```bash
git push git@github.com:blackrook-io/taskmesh.git main
```

**Pull before branch:**

```bash
git switch main
git pull git@github.com:blackrook-io/taskmesh.git main
git switch -c T####-<slug>
```
