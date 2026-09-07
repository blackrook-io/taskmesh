# Release notes

Human-readable notes for each finished TaskMesh version. Updated on every **finish up** in the same commit as the SemVer bump. Newest version blocks appear first (directly under this intro).

A future **Build release** skill will use this file to populate GitHub Release notes. After that publish clears or archives the working notes, the next finish-up must recreate this file from the stub below if it is missing or empty (header only — no version blocks), then prepend the new version entry.

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
