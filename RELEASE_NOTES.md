# Release notes

Human-readable notes for each finished TaskMesh version. Updated on every **finish up** in the same commit as the SemVer bump. Newest version blocks appear first (directly under this intro).

A future **Build release** skill will use this file to populate GitHub Release notes. After that publish clears or archives the working notes, the next finish-up must recreate this file from the stub below if it is missing or empty (header only — no version blocks), then prepend the new version entry.

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
