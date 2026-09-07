# TaskMesh

This is a personal web app that I have designed to manage my own **projects**, **ideas**, and **task lists** — with Markdown documents, tags, To Do lists, Kanban boards, a nested wiki, and freeform **Excalidraw** canvases. I got tired of having my "thought work" scattered between Github Projects, Issue boards, repositories, local markdown libraries and notes everywhere including dead-tree notebooks.

I designed the app to consolidate all of that effort and knowledge into one place, where I can have my todo lists (which I am *always* searching for a good app for to fit *my* needs), all my thoughts and plans for aspirations that I have (which are many and varied), and all of the documents that I have produced toward those goals over time. 

This app is not going to suit everyone's needs, nor shall it. I develop it for myself, and I provide zero support or warranty if you decide to use it.  Feel free to fork it, download it, install it and run it, develop on your version all you like.  **You are on your own.**

---

This app can be installed on a **bare-metal Ubuntu** server (systemd + nginx) or via **containers** (Docker Compose: app + PostgreSQL) on Windows, macOS, or Linux desktops. I run the bare-metal path on a small home minipc; Compose is the easier path for trying TaskMesh on a laptop.

**Tech Stack:** Node.js · TypeScript · Express · PostgreSQL · Drizzle ORM · Vite · React  

---

## Install

Full setup (choose **containers** or **bare-metal Ubuntu**): packages or Docker, Postgres, env, migrate, run, backups, troubleshooting:

→ **[INSTALL.md](INSTALL.md)** — start at **Choose your install**

**Containers (summary)** after installing [Docker](https://docs.docker.com/get-started/get-docker/) / Compose:

```bash
git clone https://github.com/blackrook-io/taskmesh.git
cd taskmesh
cp .env.docker.example .env.docker   # set POSTGRES_PASSWORD
docker compose --env-file .env.docker up -d --build
# UI: http://127.0.0.1:3000/
```

**Bare-metal production-style start** *after* following the Ubuntu sections in INSTALL.md:

```bash
cd /srv/taskmesh
npm run build:all
NODE_ENV=production npm start
```

**PROD (bare metal):** Express on `127.0.0.1:3000`; nginx proxies **:80** → that API (LAN: **http://\<server-ip\>/**).  
**Containers:** UI + API on published host port (default **3000**).  
**DEV:** open only **http://127.0.0.1:5173/** — Vite proxies `/api` to a separate API on **:3001** so PROD can stay up.

## Development

From the repo root (Postgres running, `.env` configured, migrations applied — see [INSTALL.md](INSTALL.md)):

```bash
npm install
cd client && npm install && cd ..
npm run db:migrate
npm run dev:web
```

| URL | Purpose |
|-----|---------|
| http://127.0.0.1:5173/ | Dev UI (use this; proxies `/api` → DEV API) |
| http://127.0.0.1:3001/api/health | DEV API health (optional direct check) |
| http://127.0.0.1:3000/api/health | PROD API (systemd; leave alone while developing) |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | DEV Express API on `:3001` with reload (`tsx watch`) |
| `npm run dev:client` | Vite on `:5173` only (proxies `/api` → `:3001`) |
| `npm run dev:web` | DEV API `:3001` + Vite `:5173` together |
| `npm run build` | Compile API TypeScript → `dist/` |
| `npm run build:client` | Production SPA → `client/dist/` |
| `npm run build:all` | API + client production builds |
| `npm start` | Run compiled API (`node dist/index.js`) |
| `npm run deploy:prod` | Build current tree + restart systemd prod behind nginx `:80` |
| `npm run db:generate` | SQL migrations from `src/db/schema.ts` |
| `npm run db:migrate` | Apply `./drizzle` migrations |
| `npm run db:studio` | Drizzle Studio |
| `npm run docs:sync-schema` | Copy-replace `docs/` schema Markdown into TaskMesh project Documents (PROD) |
| `npm run security:scan` | Defensive security scan suite (HTTP / repo / optional DB) — see [`security/scan/README.md`](security/scan/README.md) |
| `npm run security:ci` | CI-parity hard gate: `repo_static` with `--fail-on-findings` (see [`.github/workflows/security-ci.yml`](.github/workflows/security-ci.yml)) |

After editing `src/db/schema.ts`: `npm run db:generate`, review `drizzle/`, then `npm run db:migrate`.

## Security scan

Defensive audit CLI (HTTP headers/auth/CSRF/API, repo static checks + `npm audit`, optional Postgres role checks). **No exploit payloads.** Full module list and flags: [`security/scan/README.md`](security/scan/README.md). Threat model / hardening notes: [`SECURITY.md`](SECURITY.md).

From the repo root (default target: PROD `http://127.0.0.1:3000`):

```bash
npm run security:scan
# equivalent:
python3 security/scan/run.py
```

DEV API:

```bash
npm run security:scan -- --base-url http://127.0.0.1:3001
```

Credentials (optional — auth/CSRF checks **SKIP** with a reason if missing):

```bash
# ~/.config/taskmesh/worktask.env  (TASKMESH_EMAIL / TASKMESH_PASSWORD / optional TASKMESH_API_KEY)
npm run security:scan -- --env-file ~/.config/taskmesh/worktask.env
npm run security:scan -- --prompt-creds
```

Common options:

```bash
npm run security:scan -- --modules http_headers,http_auth
npm run security:scan -- --skip-db --skip-repo
npm run security:scan -- --no-html
npm run security:scan -- --fail-on-findings   # exit 1 if any check FAILs (default exit 0 when the runner completes)
```

Color console output (PASS / FAIL / SKIP + Help on findings) and a dated HTML log under `security/scan/logs/` (gitignored). `DATABASE_URL` for DB checks comes from process env, `--env-file`, or repo `.env`.

**CI (T0086 / T0124):** on push/PR to `main`, GitHub Actions runs unit tests, API and client builds, soft client lint (until T0125), and hard `repo_static` + `repo_npm_audit` scans. Details: [`SECURITY.md`](SECURITY.md) and [`security/scan/README.md`](security/scan/README.md).

## Configuration

Copy [`.env.example`](.env.example) to `.env`. Important variables:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `HOST` | API bind address (default `127.0.0.1`; use nginx for LAN) |
| `PORT` | PROD API listen port (default `3000`; used by systemd / `npm start`) |
| `DEV_API_PORT` | DEV API port for `npm run dev` / `dev:web` (default `3001`) |
| `BACKUP_SCHEDULE_PATH` | Backup schedule JSON path (default `./data/backup-schedule.json`) |
| `PROD_RELEASE_PATH` | Sidecar JSON with last PROD deploy stamp (default `./data/prod-release.json`; written by `deploy:prod`) |
| `OPENAI_API_KEY` | Enables embedded assistant (optional) |
| `ASSISTANT_DEFAULT_MODEL` | OpenAI model id (default `gpt-4.1-mini`) |

Back up **Postgres** and the uploads directory together. Commands and scheduling notes are in [INSTALL.md § Backups](INSTALL.md#18-backups).

## Schema documentation

Human-readable Postgres schema reference (conceptual / logical Mermaid ERDs, physical column tables, glossary):

→ **[docs/](docs/README.md)** · start at **[docs/database/overview.md](docs/database/overview.md)**

Drizzle source of truth remains [`src/db/schema.ts`](src/db/schema.ts). Keep the docs in sync when the schema changes (see [`.cursor/rules/schema-docs.mdc`](.cursor/rules/schema-docs.mdc)), then mirror into the TaskMesh project Documents with `npm run docs:sync-schema`.

## Release notes

Per-version outcome summaries (updated on every finish-up; consumed later by a GitHub Build-release skill):

→ **[RELEASE_NOTES.md](RELEASE_NOTES.md)**

## Features

Website-ready single-line list of major shipped capabilities (updated on finish-up when major user-facing features ship):

→ **[FEATURES.md](FEATURES.md)**

## Project layout

```
client/              # Vite + React SPA (Excalidraw canvases, TipTap Markdown, …)
  dist/              # Production static assets (after build:client)
src/
  index.ts           # Express entry (serves client/dist in production)
  routes/v1/         # REST API
  db/
    schema.ts        # Drizzle schema
    client.ts        # Pool + db
    migrate.ts       # Migration runner
drizzle/             # Generated SQL migrations + meta
docs/                # Admin/developer docs (database schema, …)
RELEASE_NOTES.md     # Per-version finish-up notes (GitHub release source later)
FEATURES.md          # Major shipped features (website-ready one-liners)
data/uploads/        # Image uploads (runtime; tracked with .gitkeep)
INSTALL.md           # Ubuntu bare-metal install guide
SECURITY.md          # Input-path audit log and re-audit checklist
security/scan/       # Defensive security scan CLI (npm run security:scan)
```

## License

GNU General Public Licens v3
