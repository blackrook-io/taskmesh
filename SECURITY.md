# TaskMesh security

Living record of input-path audits and hardening. Update this file when routes, query construction, uploads, or outbound fetch change.

**Threat model (current):** multi-user app with **email/password login** and **httpOnly session cookies** (T0096/T0084), plus **API keys** (T0063) as a second auth path on `/api/v1/*`. Public exceptions: health check, login/logout/session bootstrap, and public theme config.

**CSRF (T0087):** mutating `/api/v1/*` requests that carry a session cookie must include `X-TaskMesh-Client: ui` (SPA) and pass same-origin `Origin`/`Referer` checks when those headers are sent. `POST /auth/login` is exempt. **API key** requests bypass the CSRF header gate.

**API keys (T0063):** `Authorization: Bearer` or `X-API-Key` (never query string). Secrets are hashed at rest (`taskmesh_{ro|rw}_…`); max 3 active keys per user; default/max expiry 60 days. Read-only keys may only GET/HEAD/OPTIONS. Suspended keys → 403 `key_suspended`. Key-auth traffic is logged with `[ADMIN KEY]` / `admin_key` **only when the key’s owner holds the Administrator role** (T0108). Per-key rate limit uses Admin `api_rate_limit_per_minute`.

**Roles (T0108):** Administration UI, `/api/v1/admin/*`, and `/api/v1/backups` require the system **Administrator** role. Other authenticated users keep Settings → Profile (and the rest of the app). Custom roles are labels only. The last Administrator cannot be removed, locked, deactivated, or deleted.

**Rate limits (T0085):** in-process `express-rate-limit` budgets keyed by session user (or API key id when present), else client IP. Tight caps on login, backup run/restore, import, uploads, assistant chat, and search; loose global ceiling on `/api/v1/*`; additional per-key ceiling from system properties. Exceeded requests return **429** `rate_limited` with `Retry-After`. Store is memory-only (single Node process); multi-instance would need a shared store later.

Anyone who can reach the process without authenticating cannot read or mutate application data, but **TLS/nginx exposure** still matters — see [host hardening](#secrets-and-host-hardening-t0087).

**SQL stance:** use parameterized queries (Drizzle). Do **not** concatenate user strings into SQL. “Sanitizing” strings for SQL is not a substitute.

## Audit log

| Date | Task | What was reviewed | Outcome |
|------|------|-------------------|---------|
| 2026-08-20 | T0073 | All `/api/v1` input paths, Drizzle `sql` / `ILIKE`, uploads, backup `execFile`, assistant URL fetch, Markdown editor links, HTTP headers | Hardening below; residuals → follow-up Tasks |
| 2026-08-27 | T0087 | CSRF for cookie sessions, CSP second pass, nginx/TLS template sync, secrets/host checklist | CSRF middleware + SPA header; prod CSP `https:` images + wasm; deploy/ssl docs |
| 2026-08-27 | T0085 | Rate limits on login + expensive routes; global API ceiling | `express-rate-limit` in-memory; 429 `rate_limited` |
| 2026-08-27 | T0108 | Roles + Administration gating; last-admin guards; API-key admin logging | `requireAdministrator` on admin + backups; `admin_key` only for Administrator owners |

## Surfaces

| Surface | How input is handled | Notes |
|---------|----------------------|--------|
| JSON / query strings | `sanitizeIncomingStrings` middleware walks every string; then Zod | HTML stripped on **all** fields except passwords. Markdown keys (`body`, `description`, `message`, …) use `sanitizeMarkdown` |
| Route IDs | `parseRouteId` (positive int), including Admin | Invalid IDs → 400 |
| Search / references / tags / dependency search / assistant search / admin log `q` | Bound `ILIKE` with `ESCAPE chr(92)` via `ilikeEscaped` | `%` `_` `\` are literal; search `q` max 200 (tags 100) |
| Titles / names (ideas, docs, tasks, projects, wiki, boards, …) | `sanitizePlainText` on write and in title inputs | HTML tags stripped as you type; empty-after-strip is rejected |
| Markdown (ideas, projects, docs, wiki, task descriptions, comments, templates) | `sanitizeMarkdown` on **write** and in the Markdown editor | HTML tags stripped; links limited to `http`/`https`/`mailto`/same-origin `/…`; autolinks `<https://…>` kept |
| Canvas / image-board `document` JSON | Max 2 000 000 UTF-8 bytes | `express.json` remains 10 MB for the request envelope |
| Uploads | UUID filenames; GET uses `path.basename`; **magic-byte** sniff (jpeg/png/gif/webp) | Stored MIME is sniffed, not client-claimed |
| Assistant `fetchUrl` | http(s) only; DNS resolve; block private IPs; **manual** redirects (max 2) re-checked | No intranet/localhost fetch |
| Backups | `execFile` argv from `DATABASE_URL`, not request body | Restore/run rate-limited (T0085) |
| Session cookies | `HttpOnly`, `SameSite=Lax`, `Secure` in production | CSRF: SPA client header + Origin/Referer on mutating routes (T0087) |
| TLS | nginx terminates HTTPS :443; Express on loopback only | See [`deploy/ssl/README.md`](deploy/ssl/README.md); certbot path for public hosts |
| Import/export | Multer 20 MB; Zod row mapping; immutable fields rejected | Import rate-limited (T0085) |
| Rate limits | Per-route + global + per-API-key `express-rate-limit` (memory store) | Login IP; user/key for authenticated; Admin `api_rate_limit_per_minute` |
| API keys | Hashed secrets; Bearer / X-API-Key; RO/RW method gate | Profile + Admin lifecycle; query-string keys rejected |
| Client text inputs | Capture-phase sanitizer on every `<input>` / `<textarea>` | Skips password/file/number/date/color and TipTap `contenteditable` |

## HTTP headers

Always: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`.

**Production only** (`NODE_ENV=production`): Content-Security-Policy with `script-src 'self' 'wasm-unsafe-eval'` (Excalidraw wasm), `style-src 'self' 'unsafe-inline'` (TipTap/Excalidraw), `img-src 'self' data: blob: https:` (external note images), `worker-src 'self' blob:`, `object-src 'none'`, `frame-ancestors 'none'`. DEV omits CSP so Vite HMR works.

## Re-audit checklist

Run after adding a route or query:

1. `rg 'sql\`|\\.execute\\(|ilike\\(' src` — new `ILIKE` must use `ilikeEscaped` (or bound params + `ESCAPE`).
2. `rg 'Number\\(req\\.params' src/routes` — prefer `parseRouteId`.
3. `rg 'execFile|spawn|exec\\(' src` — no user-controlled argv/shell strings.
4. `rg 'fetch\\(' src` — outbound URLs must pass `assertUrlAllowed` / private-IP checks.
5. New Markdown fields: `optionalMarkdown` / `sanitizeMarkdown` on write.
6. New file serving: basename + nosniff; no user path join.
7. `npm test` (includes `src/lib/secureInputs.test.ts`).

## Residual risk (follow-up Tasks)

| Task | Topic |
|------|--------|
| **T0086** | Automated security tests in CI (`npm audit`, SAST) |
| **T0108** | Role-based Administration 403 (narrow `[ADMIN KEY]` logging) |
| **T0110** | Per-user record ownership / data scoping |

## Secrets and host hardening (T0087)

- **`.env`:** mode `600`, owned by the service user; never commit. Contains `DATABASE_URL` and optional `OPENAI_API_KEY`.
- **Postgres:** dedicated `taskmesh` role with least privilege on the `taskmesh` database only (not superuser).
- **OS:** run systemd unit as a non-root user; only nginx (:443/:80) exposed on the LAN/internet, not Express `:3000`.
- **TLS:** prefer HTTPS via nginx; see [`deploy/ssl/README.md`](deploy/ssl/README.md). For public hosts, use certbot/Let's Encrypt (manual setup documented there).

Not done by design in T0073/T0087: Zod `.strict()` on every body (SPA extra keys would 400); shrinking wiki/docs 500k caps; automatic certbot in deploy scripts.

## Usability trade-offs (T0073)

- Search `%` / `_` are literal, not SQL wildcards.
- `javascript:` / `data:` / `file:` Markdown links are dropped.
- Pasted raw HTML in notes is stripped.
- Fake image MIME is rejected.
- Assistant cannot fetch private/LAN URLs (including redirect-to-LAN).
- Very large canvases (>2 MB JSON) fail to save.
