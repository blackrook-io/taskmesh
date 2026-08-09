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

## Dependencies (Depends on / Required by)

```bash
# List both directions
curl -fsS "http://127.0.0.1:3000/api/v1/tasks/${TASK_ID}/dependencies"
# → { data: { dependsOn: [{id,number,title,state}], requiredBy: [...] } }

# Search candidates (title OR number)
curl -fsS "http://127.0.0.1:3000/api/v1/tasks/dependency-search?q=T0042&excludeTaskId=${TASK_ID}"
```

**Worktask Depends-on gate:** if any `dependsOn[].state` is not `complete` or `canceled`, alert and stop before planning/branch/In Progress.

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

### Finish comment template

```markdown
**Worktask completed**

- Merged branch `T0036-example-slug` → `main`
- Plan archived: `.cursor/plans/executed/2026-08-T0036-example-slug.mdc`
- Deployed to PROD (health checks OK)

<summary of what shipped>
```

## States

| API value | UI label |
|-----------|----------|
| `new` | Draft |
| `ready` | Ready |
| `in_progress` | In Progress |
| `complete` | Complete |
| `canceled` | Canceled |
| `on_hold` | On Hold |

Fresh `/worktask` starts expect `ready`. Draft (`new`) triggers the state gate (alert and wait).

## Context fields to read

From the task row: `id`, `number`, `title`, `description`, `state`, `priority`, `projectId`, `phaseId`, `parentId`.

From activity: all `kind: "comment"` bodies (chronological); skim `kind: "change"` for prior state/priority edits.

From dependencies: `dependsOn` / `requiredBy` summaries (`id`, `number`, `title`, `state`) — used for the Depends-on gate at sizing.

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
