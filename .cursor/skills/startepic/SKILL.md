---
name: startepic
description: >-
  Opens one TaskMesh epic from a parent Task (e.g. /startepic T0159): confirms
  which direct children ship in one pull request, writes one epic plan, creates
  the parent T#### branch, marks the parent In Progress, and prints the next
  /worktask paste line. Does not implement product code and does not publish.
  Use only when the user explicitly invokes /startepic or names this skill.
disable-model-invocation: true
---

# /startepic

Open an epic. Explicit invocation only. Product code and the pull request belong to later chats.

## Inputs

- User says `/startepic T0159` (or `T159`, `159`). Normalize to `T####`.
- The integer is the parent’s display **number**, not the DB `id`.

## Hard rules

1. **DEV only** — `http://127.0.0.1:3001`. Same auth, CSRF, and SSH git rules as `/worktask`. Follow [../worktask/reference.md](../worktask/reference.md), including § Epic. Never invent credentials. Never change `dueDate`.
2. **One open epic.** If `.cursor/plans/*.mdc` (not `executed/`) already contains `**Epic status:** open`, stop and name that file.
3. **Clean tree before any checkout.** If `git status --porcelain` is non-empty, stop. Do not stash, discard, or switch away from in-progress work.
4. **This skill does not implement** the members and does not open a pull request. **Finish up** is not a publish step here.
5. **Do not deploy.**

## Workflow

```
Startepic:
- [ ] 0. Auth (DEV session or API key; start `npm run dev` if :3001 is down)
- [ ] 1. Clean tree and no other open epic
- [ ] 2. Load parent, direct children, activity, dependencies
- [ ] 3. User confirms the member subset
- [ ] 4. External Depends-on gate
- [ ] 5. Interview order and parent work; draft the epic plan
- [ ] 6. User approves → branch + parent In Progress + start comment
- [ ] 7. Print the first /worktask paste line
```

### 2. Load

Resolve the parent the same way `/worktask` resolves a Task number. Load activity and dependencies. List direct children with `parentId` equal to the parent id (`GET /api/v1/tasks?projectId=`). Show each child’s `T####`, title, and state.

Propose the ship set as the direct children in `ready`. Show Draft (`new`), `in_progress`, `complete`, `canceled`, and `blocked` children and leave them out of the proposal until the user includes them. A Draft child is not a member until they mark it Ready or explicitly include it.

### 3. Confirm

Wait for the user to confirm, shrink, or extend the set. Every member is the parent or a direct child of that parent. Do not pull in grandchildren or unrelated Tasks.

### 4. External Depends-on gate

For the parent and each confirmed member, inspect `dependsOn`. A link whose Task is **outside** the confirmed set must be `complete`, `canceled`, or `pending`. Otherwise stop and name `T####`, title, and state. Do not create a branch. Links **inside** the set do not block; they become the In-epic depends-on column and the work order.

### 5. Plan

Interview for the slug and for whether the parent description has implementation of its own.

- Children go in dependency order. A member that depends on another member gets a higher `Order`.
- Parent work goes where the interview places it. Default it last when it exists. Role `parent`, status `not_started`.
- A parent with no implementation of its own is role `parent`, status `no_work`, and has no implementation section.

Write `.cursor/plans/<YYYY-MM>-T####-epic-<slug>.mdc` using the header in [../worktask/reference.md](../worktask/reference.md) § Epic. Add a `## T#### — title` section for every row that is not `no_work`. Present the plan and **wait for approval** before creating the branch.

### 6. On approval

1. `git switch main && git pull` (SSH only), then `git switch -c T####-<slug>` where `T####` is the **parent** number. SetActiveBranch to that branch.
2. `PATCH` the parent to `{ "state": "in_progress" }`. Leave confirmed children in `ready`.
3. Post **Epic started** on the parent.

### 7. Paste line

Print only the first `not_started` row:

```text
Next — open a new Agent chat and paste:

/worktask T0160
```

## While the epic is open

Add, drop, and defer only by the membership rules in [../worktask/reference.md](../worktask/reference.md) § Epic. Child implementation is `/worktask` on that member. Publish is `/finishepic`, and only when every in-scope row is `qa_accepted` or `no_work`.
