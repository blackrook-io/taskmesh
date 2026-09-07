# Release notes

Human-readable notes for each finished TaskMesh version. Updated on every **finish up** in the same commit as the SemVer bump. Newest version blocks appear first (directly under this intro).

A future **Build release** skill will use this file to populate GitHub Release notes. After that publish clears or archives the working notes, the next finish-up must recreate this file from the stub below if it is missing or empty (header only — no version blocks), then prepend the new version entry.

## 0.35.2 — 2026-09-07

### Enhancements
- `/worktask` documents Production auth: cookie session or API key, CSRF headers on mutations, credentials file outside the repo, and a `prod-login.sh` helper with session-mint fallback so agents stop rediscovering login each run.

## 0.35.1 — 2026-09-07

### Fixes
- Mermaid `erDiagram` (and other lazy diagram chunks) no longer break after a PROD redeploy when a stale tab requests an old hashed asset: missing `/assets/*` return 404 instead of `index.html`, so dynamic imports fail cleanly.
- Markdown Mermaid preview shows a Reload prompt when diagram chunks are out of date, and reliably switches back to SVG after leaving edit mode.

### Enhancements
- Production SPA serving uses `no-cache` for `index.html` and long immutable cache for hashed `/assets/*` so clients pick up new builds without serving HTML as JavaScript.

## 0.35.0 — 2026-09-07

### New Functionality
- Projects can upload EPUB Documents (up to 100 MB on the filesystem) and open them in an in-app epub.js reader with TOC, page turn, font size, and dark/light reading modes.
- Document records gain `kind` (`markdown` | `epub`) and optional `uploadId`; Markdown Documents behave as before. PDF reader remains deferred (T0119).

### Enhancements
- Documents create row uses **New:** with Markdown / EPUB / PDF kind icons (PDF disabled until T0119); EPUB titles come from package metadata on upload, with inline rename and tags below the reader.
- Reader toolbar uses compact icons for Contents, prev/next, and reading mode; dark mode follows app theme colors and stays applied across TOC navigation.

### Fixes
- Authenticated multipart uploads no longer fail with “Authentication required” after multer (request auth ALS is restored for the upload/import handlers).

## 0.34.2 — 2026-09-07

### New Functionality
- Finish-up now maintains human-readable release notes in `RELEASE_NOTES.md` for each shipped SemVer (newest first), ready for a future GitHub Build-release skill.
- If the notes file is cleared after publishing a GitHub release, the next finish-up recreates a blank stub and continues from there.

### Enhancements
- Development rules, `/worktask`, versioning, AGENTS, and README document the release-notes step alongside the SemVer bump.

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
