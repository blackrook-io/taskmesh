---
name: worktask
description: >-
  Orchestrates TaskMesh development from a Task Number (e.g. /worktask T0036):
  loads the PROD task (title, description, comments), plans and interviews,
  creates a T#### git branch, marks the task In Progress with a plan comment,
  implements, then on finish-up marks Complete with a completion comment.
  Use only when the user explicitly invokes /worktask or names this skill.
disable-model-invocation: true
---

# /worktask

Drive implementation from a TaskMesh **Task Number**. Explicit invocation only.

## Inputs

- User says `/worktask T0036` (or `T36`, `36`). Normalize to `T####` (`T0036`).
- Parse the integer **display number** (`36`), not the DB primary key `id`.

## Hard rules

1. **PROD only for task I/O** — base URL `http://127.0.0.1:3000` (systemd PROD). Never use DEV `:3001` or Vite `:5173` for task reads/writes.
2. Prefer the **HTTP API** (see [reference.md](reference.md)). Do not use raw SQL for task updates.
3. Do **not** change `dueDate`.
4. State values: `new` | `in_progress` | `complete` | `canceled` | `on_hold` (UI: Complete, not “Completed”).
5. Follow repo plan + git + finish-up rules; this skill **adds** task bookkeeping and **replaces** `phase-N-*` branch naming with `T####-*` for this workstream.

## Workflow checklist

Copy and track:

```
Worktask:
- [ ] 1. Load PROD task + activity
- [ ] 2. Scope / size check (split recommendation if needed)
- [ ] 3. State alert if not `new` (wait for user)
- [ ] 4. Interview + draft plan
- [ ] 5. User approves plan → branch + In Progress + start comment
- [ ] 6. Implement + QA checklist
- [ ] 7. User “finish up” → merge/deploy + Complete + finish comment
```

### 1. Load context (PROD)

1. Resolve task by **display number** (filter `GET /api/v1/tasks` where `number` matches).
2. Fetch activity: `GET /api/v1/tasks/{id}/activity`.
3. Treat as the prompt:
   - **Title**
   - **Description**
   - **Comments** (`kind === "comment"`) and relevant `kind === "change"` rows for history
4. Note `id`, `state`, `priority`, `projectId`, formatted number `T####`.

If not found or PROD unhealthy → stop and report.

### 2. Size / split check

If the work looks too large for one session (many unrelated surfaces, multi-day schema+UI+migration epics, unclear multi-feature bags):

- **Alert** the user.
- Recommend splitting into multiple Task records when possible.
- Wait for their decision before planning full scope.

### 3. State gate

If `state` is not `new`:

- **Alert** with current state (and any existing worktask comments / branch hints).
- Ask whether to continue, resume, or abort.
- Do not mark In Progress or create a branch until they decide.

### 4. Interview + plan

1. Interview for clarifications (even if the description looks complete).
2. Write plan: `.cursor/plans/<YYYY-MM>-T####-<slug>.mdc`.
3. Present plan; **wait for approval to implement**.

### 5. On implement approval

Only after the user approves the plan:

1. `git switch main && git pull`, then `git switch -c T####-<slug>` (e.g. `T0036-task-history-filter`).
2. SetActiveBranch to that branch.
3. PROD: `PATCH /api/v1/tasks/{id}` → `{ "state": "in_progress" }`.
4. PROD: post a comment summarizing branch + plan (path + short summary). Template in [reference.md](reference.md).
5. Implement as usual. End the implementation pass with a **QA checklist**. Do not finish-up until asked.

### 6. Finish up (user says “finish up”)

Do the normal finish-up sequence from development-rules, then **additionally**:

1. PROD comment: completion summary (branch merged, deploy note if applicable).
2. PROD: `PATCH` → `{ "state": "complete" }`.
3. Leave `dueDate` unchanged.

If the user wants finish-up **without** closing the Task (follow-ups remain), ask once and skip the Complete transition / still add a progress comment if useful.

## Branch and plan naming

| Item | Pattern | Example |
|------|---------|---------|
| Branch | `T####-<slug>` | `T0036-wiki-search` |
| Plan file | `<YYYY-MM>-T####-<slug>.mdc` | `2026-08-T0036-wiki-search.mdc` |

Do not use `phase-N-` prefixes for `/worktask` workstreams.

## Resume

If re-invoked on a task already `in_progress` with a matching local branch / plan: alert, then resume on that branch after user confirmation rather than inventing a duplicate plan/branch by default.
