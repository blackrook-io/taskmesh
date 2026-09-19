# Release notes

Human-readable notes for each finished TaskMesh version. Updated on every **finish up** in the same commit as the SemVer bump. Newest version blocks appear first (directly under this intro).

A future **Build release** skill will use this file to populate GitHub Release notes. After that publish clears or archives the working notes, the next finish-up must recreate this file from the stub below if it is missing or empty (header only — no version blocks), then prepend the new version entry.

## 0.46.0 — 2026-09-19

### Fixes
- Unauthenticated API traffic is rate-limited before auth (IP key), closing a bypass that previously burned CPU and filled `api_request_logs` with only 401s.
- API request audit rows record Express `req.ip` (trust proxy) instead of a client-supplied `X-Forwarded-For`.
- Assistant URL fetch pins the DNS address validated before connect, blocking rebinding to private addresses after lookup.
- Private-network blocklist covers CGNAT (`100.64.0.0/10`) and decimal/octal/hex IPv4 literals used as SSRF bypasses.
- `RATE_LIMIT_DISABLE=1` is ignored in production (loud startup warning); documented as a dev/test-only escape hatch.

### Enhancements
- `api_request_logs` retains **90** days by default (`API_REQUEST_LOG_RETENTION_DAYS`) with an in-process prune job and `created_at` index.

### Breaking Changes
- New index `api_request_logs_created_at_idx` (migration `0045`).

## 0.45.2 — 2026-09-19

### Fixes
- Cleared reachable client production npm high advisories (TipTap, pdf.js, react-router, xmldom via epubjs, and transitive lodash-es/nanoid) with version bumps and package overrides.
- PDF reader updated for pdf.js 6 (`cleanup` instead of removed `destroy`).

### Enhancements
- Security CI `repo_npm_audit` now audits both the repo root and `client/`; high/critical still fail the gate, moderate findings notify via PASS help text.

## 0.45.1 — 2026-09-19

### Fixes
- Reference search and task dependency search are scoped to records the caller can access, closing a cross-user enumeration gap left after the multi-user ownership migration.
- Board cards, to-do list items, document uploads, and profile avatars no longer attach another user's entity by id alone.
- Project and image-board reorder no longer let Viewers move rows for everyone; write-capable roles still reorder as before.
- Project user lists and the add-member directory no longer expose email addresses to Managers (display name and `U####` remain).
- Bare type-prefix reference queries (for example `q=T`) return 400 instead of listing every matching row of that type.

## 0.45.0 — 2026-09-19

### New Functionality
- MFA backup/recovery codes: ten single-use `XXXX-XXXX` codes issued at enroll (required one-time reveal) and on Profile regenerate; accepted on the login MFA challenge in place of TOTP.
- Administrators see remaining recovery-code count on user rows (never plaintext values).

### Enhancements
- SECURITY and schema docs cover hashed recovery codes; Clear MFA / disable / user delete wipe the set.

### Breaking Changes
- New table `mfa_recovery_codes` (migration `0044`).

## 0.44.0 — 2026-09-19

### New Functionality
- After a successful MFA challenge, users can trust the browser for a configurable number of days so subsequent password or OAuth sign-ins skip TOTP.
- Profile can revoke all trusted devices; Admin Clear MFA and user delete also clear trusts (delete also removes API keys and MFA configuration).

### Enhancements
- Administrators configure trusted-device duration (default 15 days; 0 disables) and max devices per user (default 5) under System properties.

### Breaking Changes
- New table `mfa_trusted_devices` and system properties `mfa_trusted_device_days` / `mfa_trusted_device_max` (migration `0043`).

## 0.43.1 — 2026-09-19

### Enhancements
- Local ESLint now matches the GitHub Actions client hard gate: root `npm run lint`, Cursor/VS Code ESLint working directory for `client/`, and docs noting the shared `--max-warnings 0` rules (including `react-hooks/set-state-in-effect`).

## 0.43.0 — 2026-09-19

### New Functionality
- Optional TOTP multi-factor authentication (Authenticator apps) with Profile enroll/disable and a second login step after password or OAuth.
- Administrators can require MFA for Administrators only, configure an enrollment grace period (days from first login), and unlock or clear MFA from Administration → Users.
- Accounts that miss the MFA enrollment deadline are locked with a clear login message until an administrator unlocks them.

### Enhancements
- When MFA is required for Administrators, creating API keys requires MFA enrollment; key auth is denied after MFA-deadline lock (interactive MFA still protects browser sessions).

### Breaking Changes
- New table `mfa_login_challenges` and MFA columns on `users` (migration `0042`); enrollment requires env `MFA_TOTP_KEY`. System properties `mfa_enforcement` and `mfa_grace_days` are seeded.

## 0.42.0 — 2026-09-18

### New Functionality
- Sign in with Google, Apple, or GitHub (OIDC / OAuth 2.0) in addition to email and password; successful federation creates the same TaskMesh session cookie.
- Administrators configure the three seeded providers under Administration → OAuth (write-only encrypted secrets, per-provider enable and JIT).
- Profile → Linked accounts lets users link or unlink providers without orphaning passwordless accounts.
- Administrator setup guide at `docs/OAUTH_SETUP.md` (console steps, official links, and account/fee requirements).

### Enhancements
- OAuth Admin help is a draggable, non-blocking field guide so credentials can be entered while reading instructions.

### Breaking Changes
- New tables `oauth_providers`, `user_identities`, and `oauth_login_states` (migration `0041`); enabling providers requires env `OAUTH_CREDENTIALS_KEY`.

## 0.41.0 — 2026-09-18

### New Functionality
- Project Overview panels are a personalizable canvas: add from a catalog, remove, and drag-and-drop rearrange on the responsive grid.
- Layout is per user, with a project default set by Owners/Managers/Admins and a Reset control to restore it.
- New catalog panel **My Tasks Today** lists incomplete tasks assigned to you that are due today.

### Breaking Changes
- Overview prefs API now stores ordered panel instances (`layout`) instead of a fixed key→prefs map; project defaults live in `project_overview_defaults`.

## 0.40.0 — 2026-09-18

### New Functionality
- Project Overview is a dashboard: compact project header plus four list panels (recently completed tasks, next tasks due, overdue ToDos, upcoming ToDos) in a responsive grid.
- Each panel has per-viewer Show (5/10/20) and Days controls that persist on the server for that user and project.
- Clicking a panel row opens the Task or ToDo detail modal.

### Enhancements
- Project description on Overview is editable only by Owners and Managers; Members can still edit name, status, and tags.

## 0.39.0 — 2026-09-18

### New Functionality
- Administrators can create User Groups (G####), manage members, and assign platform Roles from a new Administration → Groups tab (directly under Users).
- Groups can be added to Project Managers, Members, and Viewers alongside individual users; Group rows are labeled distinctly, and membership expands live when group membership changes.
- Platform Roles on a Group (including Administrator) grant those rights to all current members; project access uses the highest of direct and Group-derived roles (Manager > Member > Viewer).

## 0.38.1 — 2026-09-17

### Fixes
- When a session expires mid-use, the SPA redirects to the sign-in screen with a short explanation and returns you to the page you were on after login, instead of leaving "Authentication required." alerts on the page.

## 0.38.0 — 2026-09-17

### New Functionality
- Right-click any List View column header (project Tasks, global Tasks, Ideas) to open **Personalize…** and show, hide, or reorder columns; the layout is saved per user on the server and shared across projects for Tasks.
- Schema metadata (`entity_fields`) marks which fields are list-displayable; extras such as Phase, Tags, Created, Updated, Owner, and Created by are available for Tasks (and Number, Updated, Assignee for Ideas).

### Enhancements
- Reset to defaults restores the seeded column layout; sorting continues to work on visible sortable columns.

## 0.37.2 — 2026-09-17

### Enhancements
- Collapsed the two left navigation columns into a single rail: project modules (Overview, Tasks, Documents, and the rest) nest under the active project instead of a separate center pane.
- Removed global Ideas, Tasks, Filesystem, Image Board, Lists, and Calendar entries from the left rail so navigation stays project-scoped.
- Command palette (⌘K / Ctrl+K) is available to Administrators only.
- Collapsed (Less) rail icons now jump to the active project’s modules; mobile uses one Menu drawer instead of separate Menu and Section drawers.

## 0.37.1 — 2026-09-17

### New Functionality
- Project Managers, Members, and Viewers now receive real access from role lists: Managers (and Owners) get read/write plus Settings; Members get read/write; Viewers are read-only. Shared projects appear in lists and search for listed users.
- Removing a Manager or Member who still has assigned Tasks/ToDos requires reassigning those items to another Owner/Manager/Member or clearing the assignee before the role row is removed.

### Enhancements
- Project Settings (modules, phases, and Users) is available to Managers as well as Administrators; Delete project remains Administrator-only.
- Project detail responses include the actor’s effective role (`myRole`) plus `canWrite` / `canManageSettings` flags for the UI.

## 0.37.0 — 2026-09-17

### New Functionality
- Assign Tasks and ToDos to Project Owners, Managers, or Members via list context menu **Assign to…**, list-row display, and edit forms (dedicated assignee field, distinct from ownership).
- Solo-owner projects auto-assign new and moved records to the Project Owner; Ideas expose Assigned to as unassigned (no project pool).

### Enhancements
- Assigned-to dropdown labels show display names only (no U#### suffix).

## 0.36.0 — 2026-09-17

### New Functionality
- Administrators can assign active users to per-project Managers, Members, and Viewers lists under Project Settings → Users (schema ready for role enforcement in T0128).
- Project Settings (modules, phases, users, and delete) is Administrator-only until project Roles land; the project owner remains an implicit Manager and is not duplicated in the managers list.

### Enhancements
- Nested project Settings mutations (module toggles, phases, and project delete) are Administrator-gated on the API to match the Settings UI.

### Fixes
- Bumped `multer` to clear a high-severity production npm audit finding that blocked Security CI.

## 0.35.15 — 2026-09-07

### Enhancements
- Finish-up workflow now requires publishing via feature-branch pull request (wait for required CI, then merge on GitHub) and SSH-only git remotes, so agents no longer push `main` directly or try HTTPS then fall back to SSH.

## 0.35.14 — 2026-09-07

### Enhancements
- Administrators can download a complete backup archive (SQL dump, uploads tar, and manifest) from each Backups list row, with icon-only Download / Restore / Delete actions and green checkmarks for OK status columns.

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
