# Release notes

Human-readable notes for each finished TaskMesh version. Updated on every **finish up** in the same commit as the SemVer bump. Newest version blocks appear first (directly under this intro).

A future **Build release** skill will use this file to populate GitHub Release notes. After that publish clears or archives the working notes, the next finish-up must recreate this file from the stub below if it is missing or empty (header only — no version blocks), then prepend the new version entry.

## 0.58.1 — 2026-10-11

### Enhancements
- A collapsed parent on a task list shows a light grey count of the descendant rows that collapse is hiding. The number sits next to the twistie on All Tasks, a project Tasks list, and a Task Group sub-list, and it disappears when the parent is open.

## 0.58.0 — 2026-10-11

### Enhancements
- Collapsed Task Groups, including Unassigned, stay closed after a refresh and on another browser. The choice is saved for you, not for everyone on the project.
- A collapsed parent task stays closed on the project Tasks list and on All Tasks. Opening it in either place opens it in both.

## 0.57.2 — 2026-10-11

### Enhancements
- Mesh can hide reference lines or depends-on lines from the toolbar. Turning References off also hides records that are on the canvas only because of those links. The choice stays in this browser.
- The AI suggestion slot is ready for a later suggestion list: a dashed outline, a dotted join, and a card to accept the link or dismiss it. The AI chip stays hidden until suggestions exist.

## 0.57.1 — 2026-10-11

### Enhancements
- Hover or focus a record on Mesh to see its state, due date, last change, comment, contents, blockers, and links. The card sits beside the record, follows the canvas, and a first touch opens it without changing focus.

## 0.57.0 — 2026-10-11

### Enhancements
- ToDos, projects, and documents share the task activity timeline. A state or progress change, a project status change, and a document edit are recorded, and a to-do list's last update is the newest change among its items.
- Mesh's stale clock follows that update. A comment or a title edit does not reset it. A record with no such update yet counts from the day it was created.

## 0.56.4 — 2026-10-11

### Enhancements
- Mesh draws each record as its own shape and can color the cascade by type, state, or priority. In Progress and Complete stay hollow so they stay distinct from Draft and Ready.
- Due dates show as overdue or at risk, quiet records show a stale clock, and high or urgent priority shows a badge. A depends-on line points at the prerequisite and stays red until that record is complete.
- Hovering a record thickens the lines that touch it in the theme accent and draws them above the other lines, without moving the cascade.

## 0.56.3 — 2026-10-11

### Enhancements
- Administrators can set how many signed-in sessions each user may keep. The default stays 1, so a new login still signs out every other session.
- A higher limit keeps the newest sessions and drops the oldest. Expired sessions do not count. Password changes, MFA clears, and an admin lock, deactivate, or password reset still end every session.

## 0.56.2 — 2026-10-11

### New Functionality
- A project can turn on Mesh and open a cascade of its records. The focused record sits over its contents, with its own links in a row beside it and links from inside on a rail.
- Click or press Enter to refocus. Back and the breadcrumb return, and a record from another project can be sent back to this project. Labels stay readable while you pan.

## 0.56.1 — 2026-10-11

### New Functionality
- Ask for the neighbourhood of one record and get the nearby records and how they connect, up to three steps away. Membership, parents, task dependencies, lists, boards, wiki links, source ideas, and directed links are included. Tags are included only when requested.
- Finished tasks and to-dos can be left out, and a neighbourhood stops at 300 records. A missing record is not found. A record outside your access is refused.

## 0.56.0 — 2026-10-11

### Fixes
- Production dependencies are pinned past the current high and critical npm advisories (`shell-quote`, and the nested `sass` copy pulled in by canvases) so the security scan can pass.

### New Functionality
- Any two records can be linked with a directed relation: relates to, references, supports, or part of. The links API lists what a record points to and what points at it, with display numbers and a path to open each record.
- Deleting a record removes its links, including when a project delete cascades to its contents. Soft-deleted tasks and to-dos stay stored and drop out of the link list until they are restored.

## 0.55.1 — 2026-09-28

### Enhancements
- Drag a ToDo onto the middle of another ToDo in the same list to make it a child. Drag it onto the Top level strip to clear the parent. Its children move with it.
- The top and bottom edges of a row still reorder siblings and do not change the parent. Dropping on yourself, a descendant, or a Task does nothing.
- The parent dropdown and Sub button are removed from the list row and the ToDo editor. New items stay top-level.

## 0.55.0 — 2026-09-28

### Fixes
- Returning to a project To Do list keeps the rows on screen. The tab count and the list share one record, so a refresh when the window regains focus cannot replace the list with a number.

### Enhancements
- To Dos can nest. A child indents under its parent when both are on the same list. Add a sub-item from the row, or set the parent on the row and in the editor.
- A parent shows how many direct sub-items are complete and a calculated percent. Marking it complete while a sub-item is still open stores Pending. When every direct sub-item is finished, a Pending parent becomes Complete at 100%.

## 0.54.0 — 2026-09-28

### Enhancements
- To Do list rows show a progress bar from a percent stored on the ToDo. The bar is red through 25%, orange through 50%, yellow through 75%, and green from 76% up.
- Setting progress to 100% marks the ToDo Complete and checks it on every list it belongs to. Completing the ToDo or checking the row sets progress to 100%. Unchecking a completed ToDo, or moving progress below 100%, reopens it.

## 0.53.0 — 2026-09-28

### Enhancements
- The Ideas list uses the same column header as To Do lists. Drag reorder is the default. Clicking a column sorts the list and turns drag off until you return to the saved order.
- Filter Ideas by title, tags, created date, updated date, or assignee. Drag stays off while a filter is hiding rows.
- New ideas appear at the top of the manual order. Existing ideas stay newest-created first until you drag them.

## 0.52.0 — 2026-09-28

### Enhancements
- To Do lists use a shared column header. Drag reorder stays the default manual order. Clicking a column sorts that list and turns drag off until you return to the saved order.
- Right-click the To Do list header to show, hide, or reorder columns. The layout is saved for your account and applies to every To Do list.

## 0.51.0 — 2026-09-28

### Enhancements
- Administrators rename a user by double-clicking the display name in Administration → Users. Enter or leaving the field saves; Escape cancels.
- Display names are unique regardless of letter case, including when creating a user or saving Profile. A name already in use is rejected.

## 0.50.1 — 2026-09-28

### Enhancements
- Finish-up on the development host merges to `main` and no longer deploys a local production process. The public Production site is upgraded by an Administrator from a GitHub Release.
- Task bookkeeping and schema-doc sync on this host use the DEV API on port 3001.

## Format

Each finished version is a heading plus only the non-empty sections below. Bullets are 1–3 concise sentences describing **outcome** (not the work process). Call out schema or public API breaks under **Breaking Changes**.

```markdown
## x.y.z — YYYY-MM-DD

### Fixes
- …

### Enhancements
- …

### New Functionality
- …

### Breaking Changes
- …

### Deprecated Functionality
- …
```

Omit any section with nothing to report. Do not keep an `Unreleased` section.
