---
name: finishepic
description: >-
  Publishes the open TaskMesh epic: one version bump, one release-notes block,
  one pull request, then Complete on each shipped Task. Refuses unless every
  in-scope epic section is QA accepted. Use only when the user explicitly
  invokes /finishepic or names this skill.
disable-model-invocation: true
---

# /finishepic

Publish the open epic. Explicit invocation only. A fresh chat is enough; the epic plan is the source of truth.

Lone-Task **finish up** does not run this skill. **Finish up** while an epic is open does not publish.

## Hard rules

1. **DEV only** for Task comments and state. Same auth and SSH git rules as `/worktask`. Details in [../worktask/reference.md](../worktask/reference.md) § Epic and § Git ops.
2. **One open epic.** Zero `**Epic status:** open` files under `.cursor/plans/*.mdc` (ignore `executed/`): stop. Two: stop and name them.
3. **Gate.** Every member row is `qa_accepted`, `no_work`, or `dropped`, and at least one row is `qa_accepted`. Otherwise stop and name the rows that are still `not_started` or `in_progress`.
4. **Clean tree at start.** If `git status --porcelain` is non-empty, stop. Send the user back to the open slice’s `/worktask` chat. Do not stash, and do not fold uncommitted work into the version commit.
5. **One bump for the bundle.** MINOR +1 and PATCH `0` if this branch added any `drizzle/*.sql` file versus `main`; otherwise PATCH +1. Slice commits do not bump. Follow [.cursor/rules/versioning.mdc](../../rules/versioning.mdc).
6. **Do not deploy.** Do not change `dueDate`.

## Workflow

```
Finishepic:
- [ ] 1. Find the open epic plan and pass the gate
- [ ] 2. Clean tree; check out the epic branch
- [ ] 3. Version + release notes + FEATURES.md when a shipped member is major user-facing
- [ ] 4. Archive the plan on the branch (Epic status: shipped)
- [ ] 5. Pull request, required checks, merge, pull main, delete the branch
- [ ] 6. Completion comment and Complete on each shipped Task
```

### 3. Version commit

On the epic branch, in one commit:

- Bump root `package.json` and the matching `version` entries at the top of `package-lock.json`.
- Set `APP_VERSION_CREATED_AT` in `src/lib/appVersion.ts` and `APP_VERSION` plus `APP_VERSION_CREATED_AT` in `client/src/lib/appVersion.ts` to UTC now.
- Update [`RELEASE_NOTES.md`](../../../RELEASE_NOTES.md). Recreate the stub header if the file is missing or empty, then prepend `## MAJOR.MINOR.PATCH — YYYY-MM-DD` with only the non-empty sections. One outcome bullet per `qa_accepted` member. Skip `dropped` and `no_work`. Schema or public API breaks go under Breaking Changes.
- Update [`FEATURES.md`](../../../FEATURES.md) when any `qa_accepted` member added major user-facing functionality (new module, record type, reader, board type, or a similarly website-worthy perk). Skip bugfixes-only and internal workflow.

If this branch already contains the bump, do not bump again. Commit with a HEREDOC. If commit fails for missing identity, set `GIT_AUTHOR_*` and `GIT_COMMITTER_*` for that command only (see the worktask reference). Never update git config.

### 4. Archive

`git mv` the epic plan to `.cursor/plans/executed/` (same filename). Set `**Epic status:** shipped`. Commit on the epic branch (same commit as the version bump, or the commit immediately after).

### 5. Publish

`main` is protected. Do not push commits directly to `main`.

1. Push the epic branch with SSH only.
2. Open a PR into `main` (`gh pr create`, or the GitHub API with `~/.config/taskmesh/github.env` when `gh` is missing). Title and body name the parent `T####` and list the shipped member numbers.
3. Wait until required checks succeed.
4. Merge on GitHub. Prefer a merge commit unless the user asks otherwise.
5. `git switch main && git pull` (SSH). Delete the local and remote epic branch.

### 6. Tasks

Post **Epic shipped** on the parent and on each `qa_accepted` member. Include that Task’s scope, the shared version, the PR number, and QA follow-ups. State that the version is on `main`.

Then `PATCH` `{ "state": "complete" }` on each shipped **child** first, then the parent. Leave `dueDate` unchanged. Do not patch `dropped` rows or children that were never in the epic.

The API stores `pending` instead of `complete` when unfinished direct children remain. Sending `complete` on the parent after the shipped children are `complete` leaves the parent `complete` when every direct child is finished, and `pending` when some children were left out. Trust that coerce. Do not send a second patch to force `complete` over leftover children.

## After publish

The epic plan is archived. A later `/startepic` may open a new epic. Lone-Task `/worktask` finish up is unchanged for Tasks that are not members of an open epic.
