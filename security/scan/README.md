# TaskMesh defensive security scan (T0121)

CLI suite that asserts TaskMesh hardening expectations against a running instance,
plus optional repo-root and Postgres checks. **Defensive only** — no exploit
payloads, fuzz bombs, or attack PoCs.

## Quick start

From the repo root (default target: PROD `http://127.0.0.1:3000`):

```bash
npm run security:scan
# or
python3 security/scan/run.py
```

DEV API:

```bash
npm run security:scan -- --base-url http://127.0.0.1:3001
```

## Credentials (optional)

Authenticated HTTP checks (session CSRF, authenticated API samples) need either:

- `~/.config/taskmesh/worktask.env` (same shape as `/worktask`: `TASKMESH_EMAIL`, `TASKMESH_PASSWORD`, optional `TASKMESH_API_KEY`), or
- `--env-file /path/to.env`, or
- process env vars, or
- `--prompt-creds` for an interactive prompt

Without credentials, those checks are **SKIP** (yellow) with a reason — unauthenticated HTTP, repo, and DB checks still run.

`DATABASE_URL` is loaded from process env, `--env-file`, or the repo `.env` (never committed).

## Modules

| Module | What it checks |
|--------|----------------|
| `http_headers` | nosniff / Referrer-Policy / X-Frame-Options; CSP on non-DEV |
| `http_auth` | Public allowlist; protected routes → 401; optional login/API key smoke |
| `http_csrf` | Cookie mutate without SPA header / cross-origin → 403 |
| `http_api` | Health, bad-login shape, query-string API key rejected, admin unauth, auth samples |
| `repo_static` | `.env` not tracked; SECURITY.md-style greps (`Number(req.params)`, `exec()`, SSRF helper, ILIKE) |
| `repo_npm_audit` | `npm audit --omit=dev` — fail on high/critical |
| `db_postgres` | Via `psql` + `DATABASE_URL`: connect, not superuser, DB name, no CREATEDB |

```bash
python3 security/scan/run.py --modules http_headers,http_auth
python3 security/scan/run.py --skip-db --skip-repo
```

## Output

- **Console:** green PASS / red FAIL / yellow SKIP (+ reason)
- **Help:** FAIL and guided SKIP rows print a cyan **Help** block with remediation steps and doc links (bundled in each module)
- **HTML log:** `security/scan/logs/scan-YYYYMMDD-HHMMSS.html` (gitignored; use `--no-html` to skip) — includes the same Help section

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Scan runner completed successfully (PASS/FAIL/SKIP are reported in output; FAIL does **not** fail the process by default) |
| 1 | Only with `--fail-on-findings`: one or more FAIL checks |
| 2 | Runner usage / unexpected abort before a complete run |

`npm run security:scan` therefore exits **0** when the suite runs cleanly, even if e.g. `repo_npm_audit` reports high/critical advisories. Review console/HTML for findings. For a CI gate that fails the job on findings: `npm run security:scan -- --fail-on-findings` (T0086).

## CI note (T0086)

This suite is wired as `npm run security:scan` for manual and future CI use.
**T0086** owns making it (or a subset) a required CI gate alongside unit sanitizer/SSRF tests and any SAST pass — see that Task for CI workflow work.
