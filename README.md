# TaskMesh

This is a personal web app that I have designed to manage my own **projects**, **ideas**, and **task lists** — with Markdown documents, tags, To Do lists, Kanban boards, a nested wiki, and freeform **Excalidraw** canvases. I got tired of having my "thought work" scattered between Github Projects, Issue boards, repositories, local markdown libraries and notes everywhere including dead-tree notebooks.

I designed the app to consolidate all of that effort and knowledge into one place, where I can have my todo lists (which I am *always* searching for a good app for to fit *my* needs), all my thoughts and plans for aspirations that I have (which are many and varied), and all of the documents that I have produced toward those goals over time. 

This app is not going to suit everyone's needs, nor shall it. I develop it for myself, and I provide zero support or warranty if you decide to use it.  Feel free to fork it, download it, install it and run it, develop on your version all you like.  **You are on your own.**

---

This app is designed as a bare-metal Ubuntu server application (it is not Dockerized). I run this on a small minipc webserver in my home, but it could be also run from a Ubuntu Linux VM. 

**Tech Stack:** Node.js · TypeScript · Express · PostgreSQL · Drizzle ORM · Vite · React  

---

## Install

**Full bare-metal Ubuntu setup** (packages, Postgres, Node.js, clone, env, migrate, systemd, **nginx :80**, backups, troubleshooting):

→ **[INSTALL.md](INSTALL.md)**

Quick production-style start *after* following that guide:

```bash
cd /srv/taskmesh
npm run build:all
NODE_ENV=production npm start
```

**PROD:** Express on `127.0.0.1:3000`; nginx proxies **:80** → that API (LAN: **http://\<server-ip\>/**).  
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

After editing `src/db/schema.ts`: `npm run db:generate`, review `drizzle/`, then `npm run db:migrate`.

## Configuration

Copy [`.env.example`](.env.example) to `.env`. Important variables:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `HOST` | API bind address (default `127.0.0.1`; use nginx for LAN) |
| `PORT` | PROD API listen port (default `3000`; used by systemd / `npm start`) |
| `DEV_API_PORT` | DEV API port for `npm run dev` / `dev:web` (default `3001`) |
| `UPLOAD_DIR` | Image upload directory (default `data/uploads/`) |
| `UPLOAD_MAX_BYTES` | Max upload size (default 5 MiB) |
| `OPENAI_API_KEY` | Enables embedded assistant (optional) |
| `ASSISTANT_DEFAULT_MODEL` | OpenAI model id (default `gpt-4.1-mini`) |

Back up **Postgres** and the uploads directory together. Commands and scheduling notes are in [INSTALL.md § Backups](INSTALL.md#18-backups).

## Schema documentation

Human-readable Postgres schema reference (conceptual / logical Mermaid ERDs, physical column tables, glossary):

→ **[docs/](docs/README.md)** · start at **[docs/database/overview.md](docs/database/overview.md)**

Drizzle source of truth remains [`src/db/schema.ts`](src/db/schema.ts). Keep the docs in sync when the schema changes (see [`.cursor/rules/schema-docs.mdc`](.cursor/rules/schema-docs.mdc)), then mirror into the TaskMesh project Documents with `npm run docs:sync-schema`.

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
data/uploads/        # Image uploads (runtime; tracked with .gitkeep)
INSTALL.md           # Ubuntu bare-metal install guide
```

## License

GNU General Public Licens v3
