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
```

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
| `new` | New |
| `in_progress` | In Progress |
| `complete` | Complete |
| `canceled` | Canceled |
| `on_hold` | On Hold |

## Context fields to read

From the task row: `id`, `number`, `title`, `description`, `state`, `priority`, `projectId`, `phaseId`, `parentId`.

From activity: all `kind: "comment"` bodies (chronological); skim `kind: "change"` for prior state/priority edits.
