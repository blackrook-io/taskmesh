# Release notes

Human-readable notes for each finished TaskMesh version. Updated on every **finish up** in the same commit as the SemVer bump. Newest version blocks appear first (directly under this intro).

A future **Build release** skill will use this file to populate GitHub Release notes. After that publish clears or archives the working notes, the next finish-up must recreate this file from the stub below if it is missing or empty (header only — no version blocks), then prepend the new version entry.

## 0.35.13 — 2026-09-07

### Enhancements
- Cleared the client ESLint warning backlog (including `set-state-in-effect`) with derive-during-render / keyed remount patterns, re-raised Compiler and react-refresh rules to error, and hard-gated `eslint . --max-warnings 0` in Security CI.

## 0.35.12 — 2026-09-07

### Fixes
- Cleared client ESLint error baseline (useless assignment/escape/catch and Admin Database cumulative chart reassignment) so `npm run lint --prefix client` exits 0.

### Enhancements
- Security CI hard-gates client ESLint; `eslint.config.js` documents intentional warns for `set-state-in-effect`, `refs`, and react-refresh (Vite `allowConstantExport`), with deeper hook cleanup deferred to T0126.

## 0.35.11 — 2026-09-07

### Fixes
- Cleared root production `npm audit` high/critical findings: upgraded `drizzle-orm` to 0.45.2 (with matching `drizzle-kit`), replaced SheetJS `xlsx` with ExcelJS for CSV/XLSX import-export, and pinned safe transitive `qs` / `uuid` via npm overrides.

### Enhancements
- Security CI hard-gates `repo_npm_audit` (`--fail-on-findings`); SECURITY.md / README / scan docs mark T0124 complete (client ESLint remains soft until T0125).

## 0.35.10 — 2026-09-07

### Fixes
- Security CI unit-test step sets a dummy `DATABASE_URL` so middleware tests that import `db/client` can load without a Postgres service (matches local `.env` behavior).

## 0.35.9 — 2026-09-07

### Enhancements
- GitHub Actions Security CI (`.github/workflows/security-ci.yml`) gates push/PR to `main` with unit tests, API and client builds, and the T0121 `security:scan` `repo_static` hard gate (`npm run security:ci`). Client ESLint and `repo_npm_audit` remain soft until T0125 / T0124.
- SECURITY.md, README, and `security/scan/README.md` document the CI workflow and residual audit/lint Tasks.

## 0.35.8 — 2026-09-07

### New Functionality
- Defensive security scan suite (`npm run security:scan` / `security/scan/`) asserts HTTP headers, auth gates, CSRF, API surface, repo static greps, production `npm audit`, and optional Postgres role checks, with color console output, Help remediation on FAIL/SKIP, and dated HTML logs.

### Enhancements
- Root README documents Security scan usage (PROD/DEV targets, credentials, common flags); SECURITY.md points at the suite and notes CI residual T0086. Scan exits 0 when the runner completes (optional `--fail-on-findings` for CI).

## 0.35.7 — 2026-09-07

### Enhancements
- Completed tasks in project and global list views grey out the full row text (`#888`), including the state checkbox, so done items are easier to scan past.

## 0.35.6 — 2026-09-07

### New Functionality
- Optional **container install**: Docker Compose stack (`app` + PostgreSQL) with Dockerfile, `.env.docker.example`, and INSTALL.md chooser covering Windows (Docker Desktop / Hyper-V Podman), macOS, and Linux with links to official host docs.

### Enhancements
- Session cookies honor `COOKIE_SECURE` so Compose desktop HTTP can log in without Secure cookies; bare-metal HTTPS production defaults unchanged.
- README points at the install chooser and a short Compose quick start.

## 0.35.5 — 2026-09-07

### New Functionality
- Repo-root `FEATURES.md` lists major shipped capabilities as website-ready single-line bullets (Projects through Backup & data), excluding Coming Soon placeholders.

### Enhancements
- Finish-up (development rules, `/worktask`, versioning, AGENTS, README) keeps `FEATURES.md` current in the same SemVer / release-notes commit when a Task ships major user-facing functionality.

## 0.35.4 — 2026-09-07

### New Functionality
- Projects can upload PDF Documents (up to 100 MB on the filesystem, shared binary limit with EPUB) and open them in an in-app pdf.js reader with page navigation, zoom, and dark/light reading (CSS invert + hue-rotate so type stays solid and color figures stay roughly natural).
- Password-protected PDFs prompt for unlock in the reader; the password is used only for that open attempt and is not stored.

### Enhancements
- Document `kind` includes `pdf` alongside `markdown` and `epub`; Documents create enables the PDF kind icon; titles prefer PDF metadata, with inline rename and tags below the reader like EPUB.
- `#N####` Markdown/Wiki references resolve to PDF Documents the same as other document kinds.

### Fixes
- Multer `unsupported_file_type` from the upload allowlist returns HTTP 400 instead of a generic 500 “Unexpected server error”.

## 0.35.3 — 2026-09-07

### Enhancements
- Collapsed (Less) left nav: clicking Projects opens a compact picker to search and switch projects, open All projects, or create a new project without expanding the rail.

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
