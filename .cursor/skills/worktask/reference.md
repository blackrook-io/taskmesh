# /worktask API reference (PROD)

Base URL: `http://127.0.0.1:3000`

Confirm health first:

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

## Resolve Task Number → record

Display number `T0036` → integer `36`. List tasks and match `number` (not `id`):

```bash
curl -fsS 'http://127.0.0.1:3000/api/v1/tasks' \
  | jq --argjson n 36 '.data[] | select(.number == $n)'
```

Then load by primary key:

```bash
TASK_ID=…   # from previous .id
curl -fsS "http://127.0.0.1:3000/api/v1/tasks/${TASK_ID}"
curl -fsS "http://127.0.0.1:3000/api/v1/tasks/${TASK_ID}/activity"
curl -fsS "http://127.0.0.1:3000/api/v1/tasks/${TASK_ID}/dependencies"
```

If the task row has `parentId` (Child Task), load the Parent the same way (`GET /api/v1/tasks/{parentId}` and its `/activity`). If you need more context or information on a Child Task, refer to the Parent.

## Dependencies (Depends on / Required by)

```bash
# List both directions
curl -fsS "http://127.0.0.1:3000/api/v1/tasks/${TASK_ID}/dependencies"
# → { data: { dependsOn: [{id,number,title,state}], requiredBy: [...] } }

# Search candidates (title OR number)
curl -fsS "http://127.0.0.1:3000/api/v1/tasks/dependency-search?q=T0042&excludeTaskId=${TASK_ID}"
```

**Worktask Depends-on gate:** if any `dependsOn[].state` is not `complete`, `canceled`, or `pending`, alert and stop before planning/branch/In Progress. `pending` means the dependency’s own work is done (waiting on *its* children) and does not block.

### Add a dependency (relate tasks)

```bash
# New follow-up Task depends on the working Task (typical deferral link)
curl -fsS -X POST "http://127.0.0.1:3000/api/v1/tasks/${NEW_TASK_ID}/dependencies" \
  -H 'Content-Type: application/json' \
  -H 'X-TaskMesh-Client: ui' \
  -H 'Origin: http://127.0.0.1:3000' \
  -d "{\"dependsOnTaskId\": ${WORKING_TASK_ID}}"
```

### Deferred scope → new Task (interview / sizing)

When `/worktask` defers scope out of the current Task:

1. Prefer `POST /api/v1/projects/{projectId}/tasks` (same project as the working Task) with a full description (context, acceptance, why deferred from `T####`). Use `state: "new"` unless the user wants Ready. Auth: session cookie + `X-TaskMesh-Client: ui` + `Origin` on mutating calls.
2. Relate: usually new Task **Depends on** the working Task (`POST …/dependencies` as above).
3. Record the new `T####` in the plan and comments — do not leave deferrals only as plan bullets.

## Update state

```bash
curl -fsS -X PATCH "http://127.0.0.1:3000/api/v1/tasks/${TASK_ID}" \
  -H 'Content-Type: application/json' \
  -d '{"state":"in_progress"}'
```

Finish:

```bash
curl -fsS -X PATCH "http://127.0.0.1:3000/api/v1/tasks/${TASK_ID}" \
  -H 'Content-Type: application/json' \
  -d '{"state":"complete"}'
```

If unfinished direct children remain, the API stores `pending` instead of `complete`. Finishing the last child auto-completes a Pending parent — do not PATCH the parent yourself.

Do **not** send `dueDate` from this skill.

## Comments

```bash
curl -fsS -X POST "http://127.0.0.1:3000/api/v1/tasks/${TASK_ID}/activity" \
  -H 'Content-Type: application/json' \
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
