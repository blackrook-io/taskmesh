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
4. State values: `new` (UI: Draft) | `ready` (UI: Ready) | `in_progress` | `pending` (UI: Pending — own work done, waiting on children) | `complete` | `canceled` | `on_hold` (UI: Complete, not “Completed”). Fresh `/worktask` starts expect `ready`.
5. Follow repo plan + git + finish-up rules; this skill **adds** task bookkeeping and **replaces** `phase-N-*` branch naming with `T####-*` for this workstream.
6. **Never** update git config (`user.name` / `user.email`). If commit fails for missing identity, set `GIT_AUTHOR_*` and `GIT_COMMITTER_*` for that command only (see [reference.md](reference.md)).
7. **App version** — on finish-up, bump SemVer per [.cursor/rules/versioning.mdc](../../rules/versioning.mdc) in the merge commit (MINOR if this Task added a Drizzle migration, otherwise PATCH). Mention the new version in the completion comment. Do not skip the bump.
8. **Child Task → Parent** — if the Agent needs more context or information on a Child Task, it should refer to the Parent. Load the Parent from PROD (`parentId` → `GET /api/v1/tasks/{parentId}` plus description/comments as needed). Do not invent missing background.
9. **Deferred scope → new Task** — if interview/sizing defers work out of the current Task, create a PROD Task with full context and relate it via dependencies to the working Task (see §4 and [reference.md](reference.md)). Never leave deferrals only in the plan.

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
- [ ] 7. User “finish up” → version bump + merge/deploy + Complete + finish comment
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
   - **Parent** when `parentId` is set (this is a Child Task)
5. Note `id`, `state`, `priority`, `projectId`, `parentId`, formatted number `T####`.
6. If `parentId` is set: fetch the Parent from PROD. If the Child’s title, description, or comments are thin, ambiguous, or incomplete — or you otherwise need more context or information on the Child Task — **refer to the Parent** (title, description, comments, activity). Use that as the missing brief; do not ask the user to restate what the Parent already records.

If not found or PROD unhealthy → stop and report.

### 2. Size / split check

If the work looks too large for one session (many unrelated surfaces, multi-day schema+UI+migration epics, unclear multi-feature bags):

- **Alert** the user.
- Recommend splitting into multiple Task records when possible.
- Wait for their decision before planning full scope.

### 2b. Depends-on gate

After load (and as part of the sizing assessment):

1. Inspect `dependsOn` from `GET /api/v1/tasks/{id}/dependencies`.
2. If **any** Depends-on task has `state` other than `complete`, `canceled`, or `pending`:
   - **Alert** the user with the open blockers (`T####`, title, state).
   - **Stop** the workflow — do not interview/plan further, do not create a branch, do not mark In Progress.
   - No cleanup is needed if nothing was started; if this gate is hit mid-flight somehow, do not leave the task In Progress from this skill.
3. Satisfied Depends-on (`complete` / `canceled` / `pending`) are fine; empty Depends-on is fine. **Pending** means the parent’s own implementation is done and children may start.

### 3. State gate

Fresh starts expect **`ready`** (UI: Ready). Process: Draft (`new`) = still being written up; Ready = enough info to execute.

- If `state` is `ready`: proceed (interview / plan).
- If `state` is `in_progress`: **Resume** path — alert with current state / branch / plan hints; ask whether to continue, resume, or abort. Do not create a duplicate branch by default.
- If `state` is `new` (Draft): **Alert** that the task is still Draft, not Ready. Ask whether to continue anyway, wait until they mark Ready, or abort. Do not mark In Progress or create a branch until they decide.
- Any other state (`complete`, `canceled`, `pending`, `on_hold`, …): **Alert** with current state (and any existing worktask comments / branch hints). Ask whether to continue, resume, or abort. Do not mark In Progress or create a branch until they decide.

### 4. Interview + plan

1. Interview for clarifications (even if the description looks complete).
2. **Deferral → new Task (required):** Whenever interview answers (or sizing) **defer** scope out of the current worktask — a feature slice, field, modal, schema piece, or follow-up — **always** create a **new PROD Task** before treating the deferral as settled:
   - Copy **all related information and context** into the new Task (title, description with acceptance notes, why it was deferred from `T####`, relevant parent/sibling context, API/UI gaps already known).
   - Prefer the same `projectId` (and `parentId` only when it is truly a child of the same epic; otherwise leave standalone).
   - Default state `new` (Draft) unless the user asks for Ready.
   - **Relate** it to the working Task via dependencies: set the new Task’s `dependsOn` → working Task when the follow-up should wait on this work; or the reverse only when the working Task is blocked on the new one. Use `POST /api/v1/tasks/{id}/dependencies` (see [reference.md](reference.md)). Do not leave orphan deferred notes only in the plan.
   - Mention the new Task number(s) in the plan and in any later start/completion comments.
3. Write plan: `.cursor/plans/<YYYY-MM>-T####-<slug>.mdc`.
4. Present plan; **wait for approval to implement**.

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

1. **Commit** remaining work on the feature branch (HEREDOC message; author env vars if needed). If QA follow-ups shipped, mention them in the message. **Bump app version** in this commit if it is not already on the branch — follow [.cursor/rules/versioning.mdc](../../rules/versioning.mdc) (MINOR +1 / PATCH reset if this Task added a new `drizzle/*.sql` file; otherwise PATCH +1; set `createdAt` to UTC now; keep MAJOR at `0` unless breaking). T0076 ships `0.22.1`; increment from current `package.json`, do not re-count migrations.
2. **Merge** into `main` (ff-only when possible); delete local (and remote if exists) `T####-*` branch after merge.
3. **Publish** — push `main` (SSH URL if HTTPS origin fails: `git push git@github.com:blackrook-io/taskmesh.git main`).
4. **Archive** the plan — `git mv` active `.cursor/plans/<file>.mdc` → `.cursor/plans/executed/`, commit on `main`, push again. Archived plan must include any QA follow-up notes.
5. **Deploy** — `npm run deploy:prod`; confirm `:3000` and nginx HTTPS health checks succeed (script also stamps `data/prod-release.json`).
6. **PROD Task** — completion comment (include original scope, **shipped version**, and QA follow-ups), then `PATCH` `{ "state": "complete" }`. Leave `dueDate` unchanged.
   - If this task still has unfinished **direct children** (state not `complete` / `canceled` / `deleted`), the API **coerces Complete → Pending**. Prefer sending `complete` anyway and trust the coerce, or send `pending` explicitly.
   - When finishing a **child**, do not PATCH the parent yourself: if the parent is Pending and this was the last unfinished child, the API sets the parent to `complete`.

If the user wants finish-up **without** closing the Task (follow-ups remain), ask once and skip the Complete transition / still add a progress comment if useful.

## Branch and plan naming

| Item | Pattern | Example |
|------|---------|---------|
| Branch | `T####-<slug>` | `T0036-wiki-search` |
| Plan file | `<YYYY-MM>-T####-<slug>.mdc` | `2026-08-T0036-wiki-search.mdc` |

Do not use `phase-N-` prefixes for `/worktask` workstreams.

## Resume

If re-invoked on a task already `in_progress` with a matching local branch / plan: alert, then resume on that branch after user confirmation rather than inventing a duplicate plan/branch by default.
