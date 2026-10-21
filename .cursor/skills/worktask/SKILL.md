---
name: worktask
description: >-
  Orchestrates TaskMesh development from a Task Number (e.g. /worktask T0036):
  loads the task from this host's DEV API (title, description, comments),
  plans and interviews, creates a T#### git branch, marks the task In Progress
  with a plan comment, implements, records QA follow-ups in plan + Task
  comments + commits, then on finish-up marks Complete with a completion
  comment.   When the Task is a member of an open epic, still interviews and gets
  plan approval, then joins that epic branch. It commits the slice only
  after QA acceptance, and does not publish on finish up. Finish-up does
  not deploy.
  Use only when the user explicitly invokes /worktask or names this skill.
disable-model-invocation: true
---

# /worktask

Drive implementation from a TaskMesh **Task Number**. Explicit invocation only.

## Inputs

- User says `/worktask T0036` (or `T36`, `36`). Normalize to `T####` (`T0036`).
- Parse the integer **display number** (`36`), not the DB primary key `id`.

## Hard rules

1. **DEV only for task I/O** — base URL `http://127.0.0.1:3001` (`npm run dev`). Never use Vite `:5173`, port `:3000`, systemd, or a production install for task reads/writes. If `/api/health` on `:3001` fails, start `npm run dev` from the repo root and wait until it succeeds. Do not start `npm start`, `npm run deploy:prod`, or the `taskmesh` service.
1b. **Authenticate before task I/O** — the DEV API `/api/v1/*` requires a session (or API key). Run step **0. Auth** first every `/worktask` session (see [reference.md](reference.md) § Auth). Never invent credentials; never commit secrets; never put passwords in plans or comments.
2. Prefer the **HTTP API** on the DEV server (see [reference.md](reference.md)). Do not use raw SQL for task updates (auth session mint fallback in reference is the only DB exception).
3. Do **not** change `dueDate` (including on Complete).
4. State values: `new` (UI: Draft) | `blocked` (UI: Blocked — system-only; waiting on unfinished Depends-on; not a start state) | `ready` (UI: Ready) | `in_progress` | `pending` (UI: Pending — own work done, waiting on children) | `complete` | `canceled` | `on_hold` (UI: Complete, not “Completed”). Fresh `/worktask` starts expect `ready`. `blocked` is an open Depends-on blocker.
5. Follow repo plan + git + finish-up rules; this skill **adds** task bookkeeping and **replaces** `phase-N-*` branch naming with `T####-*` for this workstream.
6. **Never** update git config (`user.name` / `user.email`). If commit fails for missing identity, set `GIT_AUTHOR_*` and `GIT_COMMITTER_*` for that command only (see [reference.md](reference.md)).
7. **App version + release notes + features list** — on finish-up, bump SemVer per [.cursor/rules/versioning.mdc](../../rules/versioning.mdc) in the merge commit (MINOR if this Task added a Drizzle migration, otherwise PATCH). In the **same commit**, update repo-root [`RELEASE_NOTES.md`](../../../RELEASE_NOTES.md) (recreate the stub header if the file is missing/empty after a GitHub release clear; prepend newest `## x.y.z — YYYY-MM-DD` with only non-empty Fixes / Enhancements / New Functionality / Breaking Changes / Deprecated Functionality). When this Task adds **major user-facing functionality**, also update [`FEATURES.md`](../../../FEATURES.md) with website-ready single-line bullets (skip for bugfixes-only or internal/agent-workflow work). Mention the new version in the completion comment. Do not skip the bump or the release-notes update.
8. **Child Task → Parent** — if the Agent needs more context or information on a Child Task, it should refer to the Parent. Load the Parent from the DEV API (`parentId` → `GET /api/v1/tasks/{parentId}` plus description/comments as needed). Do not invent missing background.
9. **Deferred scope → new Task** — if interview/sizing defers work out of the current Task, create a Task on the DEV API with full context and relate it via dependencies to the working Task (see §4 and [reference.md](reference.md)). Never leave deferrals only in the plan.
10. **Do not deploy** — finish-up merges to `main` and closes the Task. Production updates are the Administrator’s Upgrade from a GitHub Release ([UPGRADES.md](../../../UPGRADES.md)). Never run `npm run deploy:prod` as part of `/worktask` or finish-up.
11. **Open epic** — after load, detect an epic plan under `.cursor/plans/` (not `executed/`) with `Epic status: open` whose member table lists this `T####` and whose status is not `dropped`. If it does, follow § 1b, then still run § 2, § 2b, § 3, and § 4 for this member. The epic branch already existing is not plan approval. **Finish up** does not publish an epic member. `/finishepic` is the only publish. See [reference.md](reference.md) § Epic.

## Workflow checklist

Copy and track:

```
Worktask:
- [ ] 0. Auth (DEV session or API key; start `npm run dev` if :3001 is down)
- [ ] 1. Load task + activity from the DEV API
- [ ] 1b. Open epic? If this Task is a non-dropped member, run the § 1b gates, then still interview and plan (§ 2–4) before product edits
- [ ] 2. Scope / size check (split recommendation if needed)
- [ ] 2b. Depends-on gate (stop if open blockers)
- [ ] 3. State gate (`ready` to start; Draft/`new` or other → alert & wait)
- [ ] 4. Interview + draft plan
- [ ] 5. User approves plan → branch + In Progress + start comment
- [ ] 6. Implement + QA checklist
- [ ] 6b. QA follow-ups → update plan + Task comment + commit message
- [ ] 7. User “finish up” → version bump + PR merge + Complete + finish comment (no deploy). Epic members: do not run this step
```

### 0. Auth (DEV)

Do this before any `GET`/`PATCH`/`POST` to `/api/v1/tasks` (or other app data).

1. Prefer the helper: `.cursor/skills/worktask/scripts/dev-login.sh` (starts `npm run dev` when `:3001` is down; writes cookie jar `/tmp/tm-dev-cookies.txt`, cookie name `taskmesh_session_dev`).
2. Or follow [reference.md](reference.md) § Auth manually:
   - Credentials from `~/.config/taskmesh/worktask.env` (`TASKMESH_EMAIL` / `TASKMESH_PASSWORD`). If missing, ask the user once and write that file (`chmod 600`). **Never** hardcode or commit secrets.
   - Optional: `TASKMESH_API_KEY` → use `Authorization: Bearer …` on every call (skips CSRF; no cookie jar).
   - Session path: login → cookie jar → verify `GET /api/v1/auth/session`; re-login when stale.
   - Mutating session calls need `X-TaskMesh-Client: ui` + `Origin: http://127.0.0.1:3001`.
3. If password login fails on this host, use the **session mint fallback** in reference (still not for task row updates).

### 1. Load context (DEV API)

Requires step 0 (authenticated curls).

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
6. If `parentId` is set: fetch the Parent from the DEV API. If the Child’s title, description, or comments are thin, ambiguous, or incomplete — or you otherwise need more context or information on the Child Task — **refer to the Parent** (title, description, comments, activity). Use that as the missing brief; do not ask the user to restate what the Parent already records.

If not found, auth fails, or the DEV API is unhealthy after starting `npm run dev` → stop and report.

### 1b. Open epic member

Run these gates before sizing, the Depends-on gate, the state gate, or any product edit.

1. Find `**Epic status:** open` in `.cursor/plans/*.mdc` only. Ignore `.cursor/plans/executed/`.
2. If no open epic lists this Task with a status other than `dropped`, leave this section and continue at § 2. If two open epics list it, stop and name both files.
3. This section does **not** replace § 2, § 2b, § 3, or § 4. Joining the epic branch is not plan approval and is not permission to edit product code. Do not create a branch from `main`. Do not open a pull request. Finish up stays item 10 below.

Then:

1. **Tree.** If `HEAD` is not the epic branch and `git status --porcelain` is non-empty, stop. Do not stash or discard. If `HEAD` is the epic branch, a dirty tree stays; account for it in the interview. Do not treat it as approval to keep editing.
2. **One writer.** If another member row is `in_progress`, stop and name that Task.
3. **Order.** If an in-epic Depends-on row is not `qa_accepted` or `dropped`, stop and name it. A Depends-on Task that is **not** in the member table still uses the lone-Task gate: stop unless its state is `complete`, `canceled`, or `pending`.
4. **Parent `no_work`.** When this Task is the parent row and its status is `no_work`, do not implement. Print the next paste line (lowest `Order` whose status is `not_started`). When every in-scope row is `qa_accepted` or `no_work`, tell the user to open a new Agent chat and run `/finishepic`. Stop.
5. **Already accepted.** When this row is `qa_accepted`, do not start another slice. Print the next paste line, or point at `/finishepic`. Stop.
6. **Resume only after an approved plan.** When this row is `in_progress` and the member section contains the exact line `**Implementation plan:** approved`, tell the user you are resuming that section (epic branch and plan path) and continue implementation. Do not reset the status. Do not open a second interview unless the user asks to replan.
7. **Interview and plan before code.** When this row is `not_started`, or the row is `in_progress` but the section says `**Implementation plan:** pending` or has no such line, do not set the row to `in_progress`, do not `PATCH` the Task, and do not edit product code. A section written by `/startepic` is a stub, not an approved plan. Continue at § 2 and apply the epic overrides in § 3, § 4, and § 5. Existing uncommitted work on the epic branch stays; do not stash or discard it.
8. **QA follow-ups** append to that section and post a Task comment. Re-issue the checklist.
9. **QA accepted** when the user says `QA passed`, `QA pass`, or `this task passed`. If the wording is only vaguely positive, ask once. Then commit the slice on the epic branch (HEREDOC; author env vars if needed). The message names `T####` and any QA follow-ups. No version bump, no `RELEASE_NOTES.md`, no archive, no pull request. Set the row to `qa_accepted`. Post the QA-accepted comment. Print the next paste line, or tell the user to open a new chat and run `/finishepic` when no `not_started` row remains.
10. **Finish up.** Do not commit, bump, archive, open a pull request, or `PATCH` `complete`. Say that finish up does not apply during an epic. If this section is not `qa_accepted`, say so. If every in-scope row is `qa_accepted` or `no_work`, point at `/finishepic`.
11. **Add / drop / defer** when the user asks, using the rules in [reference.md](reference.md) § Epic. Update the member table and post a comment on the parent.

Paste line, and only the next child:

```text
Next — open a new Agent chat and paste:

/worktask T0160
```

### 2. Size / split check

If the work looks too large for one session (many unrelated surfaces, multi-day schema+UI+migration epics, unclear multi-feature bags):

- **Alert** the user.
- Recommend splitting into multiple Task records when possible.
- Wait for their decision before planning full scope.

### 2b. Depends-on gate

After load (and as part of the sizing assessment):

**Epic member (§ 1b):** a Depends-on Task that is in the member table does not stop this gate when that row is `qa_accepted` or `dropped`. Its Task state stays `in_progress` until `/finishepic`. § 1b already stopped the chat when that row was anything else. Apply the stop below only to Depends-on Tasks outside the epic.

1. Inspect `dependsOn` from `GET /api/v1/tasks/{id}/dependencies`.
2. If **any** Depends-on task has `state` other than `complete`, `canceled`, or `pending` (`blocked` is an open blocker):
   - **Alert** the user with the open blockers (`T####`, title, state).
   - **Stop** the workflow — do not interview/plan further, do not create a branch, do not mark In Progress.
   - No cleanup is needed if nothing was started; if this gate is hit mid-flight somehow, do not leave the task In Progress from this skill.
3. Satisfied Depends-on (`complete` / `canceled` / `pending`) are fine; empty Depends-on is fine. **Pending** means the parent’s own implementation is done and children may start.

### 3. State gate

Fresh starts expect **`ready`** (UI: Ready). Process: Draft (`new`) = still being written up; Ready = enough info to execute.

**Epic member (§ 1b):** do not ask to reuse or replace the epic branch. `ready` proceeds to the interview. `blocked` only because of an in-epic Depends-on that § 1b already allowed also proceeds to the interview. `in_progress` with `**Implementation plan:** approved` resumes. `in_progress` without that line interviews before further product edits and keeps any existing uncommitted work.

- If `state` is `ready`: proceed (interview / plan). Before creating a branch, check for an existing local or remote `T####-*` branch. A task moved back to Ready may already have one from earlier work. If it exists, ask whether to reuse or replace it. Do not create a second branch by default.
- If `state` is `in_progress`: **Resume** path — alert with current state / branch / plan hints; ask whether to continue, resume, or abort. Do not create a duplicate branch by default.
- If `state` is `new` (Draft): **Alert** that the task is still Draft, not Ready. Ask whether to continue anyway, wait until they mark Ready, or abort. Do not mark In Progress or create a branch until they decide.
- Any other state (`complete`, `canceled`, `pending`, `on_hold`, …): **Alert** with current state (and any existing worktask comments / branch hints). Ask whether to continue, resume, or abort. Do not mark In Progress or create a branch until they decide.

### 4. Interview + plan

**Epic member (§ 1b):** run this same interview, including when `/startepic` already wrote a stub or a scope sketch. Record the plan in that member’s `## T####` section of the epic plan. Set the exact line `**Implementation plan:** pending` until the user approves. Do not create a second plan file. Do not `PATCH` `in_progress`. Do not edit product code. Deferrals still become new Tasks; update epic membership only when the user adds or drops a member.

1. Interview for clarifications (even if the description looks complete).
2. **Deferral → new Task (required):** Whenever interview answers (or sizing) **defer** scope out of the current worktask — a feature slice, field, modal, schema piece, or follow-up — **always** create a **new Task on the DEV API** before treating the deferral as settled:
   - Copy **all related information and context** into the new Task (title, description with acceptance notes, why it was deferred from `T####`, relevant parent/sibling context, API/UI gaps already known).
   - Prefer the same `projectId` (and `parentId` only when it is truly a child of the same epic; otherwise leave standalone).
   - Default state `new` (Draft) unless the user asks for Ready.
   - **Relate** it to the working Task via dependencies: set the new Task’s `dependsOn` → working Task when the follow-up should wait on this work; or the reverse only when the working Task is blocked on the new one. Use `POST /api/v1/tasks/{id}/dependencies` (see [reference.md](reference.md)). Do not leave orphan deferred notes only in the plan.
   - Mention the new Task number(s) in the plan and in any later start/completion comments.
3. Write plan: `.cursor/plans/<YYYY-MM>-T####-<slug>.mdc`. **Epic member:** skip this path; the epic section from the override above is the plan.
4. Present plan; **wait for approval to implement**.

### 5. On implement approval

Only after the user approves the plan.

**Epic member:** do not create a branch. If `HEAD` is not the epic branch, check it out only when `git status --porcelain` is empty. If the tree is dirty and `HEAD` is elsewhere, stop. Set the member row to `in_progress`, set the exact line `**Implementation plan:** approved` in that section, `PATCH` `{ "state": "in_progress" }`, post the epic-member start comment ([reference.md](reference.md) § Epic), and implement only that section. End with a QA checklist. Do not finish-up until asked. Skip the lone-Task steps below.

**Lone Task:**

1. `git switch main && git pull` (**SSH only** — see [reference.md](reference.md) § Git ops), then `git switch -c T####-<slug>`. If a `T####-*` branch already exists because the task was returned to Ready, ask whether to reuse or replace it instead of creating another.
2. SetActiveBranch to that branch.
3. DEV API: `PATCH /api/v1/tasks/{id}` → `{ "state": "in_progress" }`.
4. DEV API: post a comment summarizing branch + plan (path + short summary). Template in [reference.md](reference.md).
5. Implement as usual. End the implementation pass with a **QA checklist**. Do not finish-up until asked.

### 5b. QA follow-ups (during review)

When the user requests **new functionality or corrections** during QA:

1. **Update the plan** — append a “QA follow-ups” section (what changed / why). Keep the plan file current before the next checklist or finish-up. On an epic member, append that note under the member’s section of the epic plan.
2. **Task comment** — post a progress comment on the DEV API summarizing the QA changes (template in [reference.md](reference.md)). Do this when the follow-up pass lands, not only at Complete.
3. **Commit message** — when committing that work (or on finish-up), name the QA additions/fixes explicitly alongside any original scope.
4. Re-issue an updated **QA checklist** for the new/changed behavior.

### 6. Finish up (user says “finish up”)

If § 1b applied, do not run this section.

Do **all** of the following in order (same as development-rules, with Task bookkeeping last). **`main` is protected** (required status checks) — never push commits directly to `main`. This is the lone-Task publish. An open epic publishes only through `/finishepic`.

1. **Commit** remaining work on the feature branch (HEREDOC message; author env vars if needed). If QA follow-ups shipped, mention them in the message. **Bump app version** in this commit if it is not already on the branch — follow [.cursor/rules/versioning.mdc](../../rules/versioning.mdc) (MINOR +1 / PATCH reset if this Task added a new `drizzle/*.sql` file; otherwise PATCH +1; set `createdAt` to UTC now; keep MAJOR at `0` unless breaking). T0076 ships `0.22.1`; increment from current `package.json`, do not re-count migrations. **Same commit:** update [`RELEASE_NOTES.md`](../../../RELEASE_NOTES.md) — recreate stub if missing/empty, then prepend the new version block (outcome-focused bullets; omit empty sections; Breaking Changes when schema/API breaks). If this Task shipped **major user-facing functionality**, update [`FEATURES.md`](../../../FEATURES.md) in that commit too (single-line website bullets; skip for bugfixes-only / internal workflow). See [development-rules.mdc](../../rules/development-rules.mdc).
2. **Archive the plan on the feature branch** — `git mv` active `.cursor/plans/<file>.mdc` → `.cursor/plans/executed/` (same filename), commit on the feature branch (can be the same finish-up commit as step 1, or immediately after). Archived plan must include any QA follow-up notes. Do **not** leave the archive commit for after merge to `main`.
3. **Publish via PR (required)** — do **not** merge locally into `main` and push `main`:
   1. Push the **feature branch** with SSH only (see [reference.md](reference.md) § Git ops).
   2. Open a PR into `main` (`gh pr create`, or GitHub API + `~/.config/taskmesh/github.env` if `gh` is unavailable — see reference).
   3. Wait until required checks succeed (e.g. “Tests, build, lint, repo scan”).
   4. Merge the PR on GitHub (`gh pr merge` or API). Prefer merge commit unless the user asks otherwise.
   5. `git switch main && git pull` (SSH), then delete local and remote `T####-*` branch.
4. **Task** — completion comment on the DEV API (include original scope, **shipped version**, PR number if useful, and QA follow-ups). State that the version is on `main` and that the public Production site is upgraded by the Administrator from a GitHub Release — this step does not deploy. Then `PATCH` `{ "state": "complete" }`. Leave `dueDate` unchanged.
   - If this task still has unfinished **direct children** (state not `complete` / `canceled` / `deleted`), the API **coerces Complete → Pending**. Prefer sending `complete` anyway and trust the coerce, or send `pending` explicitly.
   - When finishing a **child**, do not PATCH the parent yourself: if the parent is Pending and this was the last unfinished child, the API sets the parent to `complete`.

If the user wants finish-up **without** closing the Task (follow-ups remain), ask once and skip the Complete transition / still add a progress comment if useful.

## Branch and plan naming

| Item | Pattern | Example |
|------|---------|---------|
| Branch | `T####-<slug>` | `T0036-wiki-search` |
| Plan file | `<YYYY-MM>-T####-<slug>.mdc` | `2026-08-T0036-wiki-search.mdc` |
| Epic branch | `T####-<slug>` (parent number) | `T0159-mesh` |
| Epic plan | `<YYYY-MM>-T####-epic-<slug>.mdc` | `2026-10-T0159-epic-mesh.mdc` |
| Epic member plan | `## T####` section in the epic plan. `**Implementation plan:** pending`, then `approved` after that chat’s approval | `## T0160` |

Do not use `phase-N-` prefixes for `/worktask` workstreams.

## Resume

If re-invoked on a lone Task already `in_progress` with a matching local branch / plan: alert, then resume on that branch after user confirmation rather than inventing a duplicate plan/branch by default.

An open epic branch does not skip the interview. Resume an epic member without a new interview only when that member’s section contains `**Implementation plan:** approved`. Otherwise run § 4 on the epic branch before further product edits.

If the task is `ready` again but a `T####-*` branch already exists, ask whether to reuse or replace that branch before creating a new one.
