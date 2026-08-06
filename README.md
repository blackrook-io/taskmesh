# TaskMesh

Personal web app for **projects**, **ideas**, and **task lists** — with Markdown documents, tags, To Do lists, Kanban boards, a nested wiki, and freeform **Excalidraw** canvases.

**Stack:** Node.js · TypeScript · Express · PostgreSQL · Drizzle ORM · Vite · React  

Single-user, private-network oriented (no auth in this build). Deletions require confirmation in the UI.

## Install

**Full bare-metal Ubuntu setup** (packages, Postgres, Node.js, clone, env, migrate, systemd, **nginx :80**, backups, troubleshooting):

→ **[INSTALL.md](INSTALL.md)**

Quick production-style start *after* following that guide:

```bash
cd /srv/taskmesh
npm run build:all
NODE_ENV=production npm start
```

On the server: http://127.0.0.1:3000/ — on the LAN after nginx (§15): **http://\<server-ip\>/** (API under `/api/...`, health at `/api/health`).

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
| http://127.0.0.1:5173/ | Vite SPA (proxies `/api` to the API) |
| http://127.0.0.1:3000/api/health | API health |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Express API with reload (`tsx watch`) |
| `npm run dev:client` | Vite only (`client/`; proxies `/api`) |
| `npm run dev:web` | API + Vite together |
| `npm run build` | Compile API TypeScript → `dist/` |
| `npm run build:client` | Production SPA → `client/dist/` |
| `npm run build:all` | API + client production builds |
| `npm start` | Run compiled API (`node dist/index.js`) |
| `npm run db:generate` | SQL migrations from `src/db/schema.ts` |
| `npm run db:migrate` | Apply `./drizzle` migrations |
| `npm run db:studio` | Drizzle Studio |

After editing `src/db/schema.ts`: `npm run db:generate`, review `drizzle/`, then `npm run db:migrate`.

## Configuration

Copy [`.env.example`](.env.example) to `.env`. Important variables:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `HOST` | API bind address (default `127.0.0.1`; use nginx for LAN) |
| `PORT` | API listen port (default `3000`) |
| `UPLOAD_DIR` | Image upload directory (default `data/uploads/`) |
| `UPLOAD_MAX_BYTES` | Max upload size (default 5 MiB) |
| `OPENAI_API_KEY` | Enables embedded assistant (optional) |
| `ASSISTANT_DEFAULT_MODEL` | OpenAI model id (default `gpt-4.1-mini`) |

Back up **Postgres** and the uploads directory together. Commands and scheduling notes are in [INSTALL.md § Backups](INSTALL.md#18-backups).

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
data/uploads/        # Image uploads (runtime; tracked with .gitkeep)
INSTALL.md           # Ubuntu bare-metal install guide
```

## License

Private / unspecified — add a `LICENSE` when you decide.
