---
name: worktask
description: >-
  Orchestrates TaskMesh development from a Task Number (e.g. /worktask T0036):
  loads the PROD task (title, description, comments), plans and interviews,
  creates a T#### git branch, marks the task In Progress with a plan comment,
  implements, records QA follow-ups in plan + Task comments + commits, then on
  finish-up marks Complete with a completion comment.
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
3. Do **not** change `dueDate` (including on Complete).
4. State values: `new` (UI: Draft) | `ready` (UI: Ready) | `in_progress` | `complete` | `canceled` | `on_hold` (UI: Complete, not “Completed”). Fresh `/worktask` starts expect `ready`.
5. Follow repo plan + git + finish-up rules; this skill **adds** task bookkeeping and **replaces** `phase-N-*` branch naming with `T####-*` for this workstream.
6. **Never** update git config (`user.name` / `user.email`). If commit fails for missing identity, set `GIT_AUTHOR_*` and `GIT_COMMITTER_*` for that command only (see [reference.md](reference.md)).

## Workflow checklist

Copy and track:

```
Worktask:
- [ ] 1. Load PROD task + activity
- [ ] 2. Scope / size check (split recommendation if needed)
- [ ] 2b. Depends-on gate (stop if open blockers)
- [ ] 3. State gate (`ready` to start; Draft/`new` or other → alert & wait)
- [ ] 4. Interview + draft plan
- [ ] 5. User approves plan → branch + In Progress + start comment
- [ ] 6. Implement + QA checklist
- [ ] 6b. QA follow-ups → update plan + Task comment + commit message
- [ ] 7. User “finish up” → merge/deploy + Complete + finish comment
```

### 1. Load context (PROD)

1. Resolve task by **display number** (filter `GET /api/v1/tasks` where `number` matches).
2. Fetch activity: `GET /api/v1/tasks/{id}/activity`.
3. Fetch dependencies: `GET /api/v1/tasks/{id}/dependencies` → `dependsOn` / `requiredBy`.
4. Treat as the prompt:
   - **Title**
   - **Description**
   - **Comments** (`kind === "comment"`) and relevant `kind === "change"` rows for history
   - **Depends on** (blocking tasks)
5. Note `id`, `state`, `priority`, `projectId`, formatted number `T####`.

If not found or PROD unhealthy → stop and report.

### 2. Size / split check

If the work looks too large for one session (many unrelated surfaces, multi-day schema+UI+migration epics, unclear multi-feature bags):

- **Alert** the user.
- Recommend splitting into multiple Task records when possible.
- Wait for their decision before planning full scope.

### 2b. Depends-on gate

After load (and as part of the sizing assessment):

1. Inspect `dependsOn` from `GET /api/v1/tasks/{id}/dependencies`.
2. If **any** Depends-on task has `state` other than `complete` or `canceled`:
   - **Alert** the user with the open blockers (`T####`, title, state).
   - **Stop** the workflow — do not interview/plan further, do not create a branch, do not mark In Progress.
   - No cleanup is needed if nothing was started; if this gate is hit mid-flight somehow, do not leave the task In Progress from this skill.
3. Terminal Depends-on (`complete` / `canceled`) are fine; empty Depends-on is fine.

### 3. State gate

Fresh starts expect **`ready`** (UI: Ready). Process: Draft (`new`) = still being written up; Ready = enough info to execute.

- If `state` is `ready`: proceed (interview / plan).
- If `state` is `in_progress`: **Resume** path — alert with current state / branch / plan hints; ask whether to continue, resume, or abort. Do not create a duplicate branch by default.
- If `state` is `new` (Draft): **Alert** that the task is still Draft, not Ready. Ask whether to continue anyway, wait until they mark Ready, or abort. Do not mark In Progress or create a branch until they decide.
- Any other state (`complete`, `canceled`, `on_hold`, …): **Alert** with current state (and any existing worktask comments / branch hints). Ask whether to continue, resume, or abort. Do not mark In Progress or create a branch until they decide.

### 4. Interview + plan

1. Interview for clarifications (even if the description looks complete).
2. Write plan: `.cursor/plans/<YYYY-MM>-T####-<slug>.mdc`.
3. Present plan; **wait for approval to implement**.

### 5. On implement approval

Only after the user approves the plan:

1. `git switch main && git pull` (use SSH remote if HTTPS cannot auth — see reference), then `git switch -c T####-<slug>`.
2. SetActiveBranch to that branch.
3. PROD: `PATCH /api/v1/tasks/{id}` → `{ "state": "in_progress" }`.
4. PROD: post a comment summarizing branch + plan (path + short summary). Template in [reference.md](reference.md).
5. Implement as usual. End the implementation pass with a **QA checklist**. Do not finish-up until asked.

### 5b. QA follow-ups (during review)

When the user requests **new functionality or corrections** during QA:

1. **Update the plan** — append a “QA follow-ups” section (what changed / why). Keep the plan file current before the next checklist or finish-up.
2. **PROD Task comment** — post a progress comment summarizing the QA changes (template in [reference.md](reference.md)). Do this when the follow-up pass lands, not only at Complete.
3. **Commit message** — when committing that work (or on finish-up), name the QA additions/fixes explicitly alongside any original scope.
4. Re-issue an updated **QA checklist** for the new/changed behavior.

### 6. Finish up (user says “finish up”)

Do **all** of the following in order (same as development-rules, with Task bookkeeping last):

1. **Commit** remaining work on the feature branch (HEREDOC message; author env vars if needed). If QA follow-ups shipped, mention them in the message.
2. **Merge** into `main` (ff-only when possible); delete local (and remote if exists) `T####-*` branch after merge.
3. **Publish** — push `main` (SSH URL if HTTPS origin fails: `git push git@github.com:blackrook-io/taskmesh.git main`).
4. **Archive** the plan — `git mv` active `.cursor/plans/<file>.mdc` → `.cursor/plans/executed/`, commit on `main`, push again. Archived plan must include any QA follow-up notes.
5. **Deploy** — `npm run deploy:prod`; confirm `:3000` and nginx HTTPS health checks succeed.
6. **PROD Task** — completion comment (include original scope **and** QA follow-ups), then `PATCH` `{ "state": "complete" }`. Leave `dueDate` unchanged.

If the user wants finish-up **without** closing the Task (follow-ups remain), ask once and skip the Complete transition / still add a progress comment if useful.

## Branch and plan naming

| Item | Pattern | Example |
|------|---------|---------|
| Branch | `T####-<slug>` | `T0036-wiki-search` |
| Plan file | `<YYYY-MM>-T####-<slug>.mdc` | `2026-08-T0036-wiki-search.mdc` |

Do not use `phase-N-` prefixes for `/worktask` workstreams.

## Resume

If re-invoked on a task already `in_progress` with a matching local branch / plan: alert, then resume on that branch after user confirmation rather than inventing a duplicate plan/branch by default.
