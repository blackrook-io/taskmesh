# Agent guidance (TaskMesh)

This repo is a **Node.js + TypeScript** API (**Express**, **PostgreSQL**, **Drizzle ORM**). Authoritative setup, Ubuntu packages, and `DATABASE_URL` live in [README.md](README.md).

## Cursor rules

Persistent product and engineering context is under [.cursor/rules/](.cursor/rules/):

- **platform-rules.mdc** — product vision, stack, UI, security (always applied).
- **coding-rules.mdc** — code quality expectations when editing `**/*.ts`.
- **development-rules.mdc** — where to put and archive `.cursor/plans/*.mdc`.

## Common commands

| Goal | Command |
|------|---------|
| API + SPA dev (two processes) | `npm run dev:web` (from repo root; run `npm install` in `client/` the first time) |
| Dev API only | `npm run dev` |
| Production bundles | `npm run build:all` then `NODE_ENV=production npm start` |
| DB migrations | `npm run db:migrate` |
| After editing `src/db/schema.ts` | `npm run db:generate`, review `drizzle/`, then `npm run db:migrate` |

Health check when running locally: `GET /api/health`.

Image uploads default to `data/uploads/` (see `.env.example` for `UPLOAD_DIR`). Back up that directory with Postgres dumps.
