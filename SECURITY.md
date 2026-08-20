# TaskMesh security

Living record of input-path audits and hardening. Update this file when routes, query construction, uploads, or outbound fetch change.

**Threat model (current):** single-user app on a private network. **No authentication** on the HTTP API. Anyone who can reach the process (typically `127.0.0.1:3000` behind nginx) can read and write all data, restore backups, and call admin routes. That is accepted until [T0084](#follow-up-tasks).

**SQL stance:** use parameterized queries (Drizzle). Do **not** concatenate user strings into SQL. “Sanitizing” strings for SQL is not a substitute.

## Audit log

| Date | Task | What was reviewed | Outcome |
|------|------|-------------------|---------|
| 2026-08-20 | T0073 | All `/api/v1` input paths, Drizzle `sql` / `ILIKE`, uploads, backup `execFile`, assistant URL fetch, Markdown editor links, HTTP headers | Hardening below; residuals → follow-up Tasks |

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
| Backups | `execFile` argv from `DATABASE_URL`, not request body | Restore still **unauthenticated** (T0084 / T0085) |
| Import/export | Multer 20 MB; Zod row mapping; immutable fields rejected | DoS residual without rate limits |
| Client text inputs | Capture-phase sanitizer on every `<input>` / `<textarea>` | Skips password/file/number/date/color and TipTap `contenteditable` |

## HTTP headers

Always: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`.

**Production only** (`NODE_ENV=production`): Content-Security-Policy with `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (TipTap/Excalidraw), `img-src 'self' data: blob:`, `worker-src 'self' blob:`, `object-src 'none'`, `frame-ancestors 'none'`. DEV omits CSP so Vite HMR works.

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
| **T0084** | Authentication and session binding |
| **T0085** | API rate limiting and abuse controls |
| **T0086** | Automated security tests in CI (`npm audit`, SAST) |
| **T0087** | Public-internet / multi-user hardening (CSRF, TLS review, CSP second pass) |

Not done by design in T0073: Zod `.strict()` on every body (SPA extra keys would 400); shrinking wiki/docs 500k caps; disabling assistant fetch.

## Usability trade-offs (T0073)

- Search `%` / `_` are literal, not SQL wildcards.
- `javascript:` / `data:` / `file:` Markdown links are dropped.
- Pasted raw HTML in notes is stripped.
- Fake image MIME is rejected.
- Assistant cannot fetch private/LAN URLs (including redirect-to-LAN).
- Very large canvases (>2 MB JSON) fail to save.
