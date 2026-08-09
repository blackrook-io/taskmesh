# Agent guidance (TaskMesh)

This repo is a **Node.js + TypeScript** API (**Express**, **PostgreSQL**, **Drizzle ORM**) plus a **Vite + React** SPA in `client/`. Authoritative Ubuntu install and `DATABASE_URL` setup live in [INSTALL.md](INSTALL.md); product overview and scripts in [README.md](README.md).

## Schema documentation

Human-readable database docs live under [docs/](docs/README.md) (start at [docs/database/overview.md](docs/database/overview.md)). Drizzle definitions remain in [`src/db/schema.ts`](src/db/schema.ts). When schema or migrations change, update `docs/database/` in the same change set, then run `npm run docs:sync-schema` to copy-replace the mirror into the **TaskMesh** project Documents (PROD). See [`.cursor/rules/schema-docs.mdc`](.cursor/rules/schema-docs.mdc).

## Cursor rules

Persistent product and engineering context is under [.cursor/rules/](.cursor/rules/):

- **platform-rules.mdc** — product vision, stack, UI, security (always applied).
- **coding-rules.mdc** — code quality expectations when editing `**/*.ts`.
- **development-rules.mdc** — plan files under `.cursor/plans/`, archive to `executed/`, feature git workflow (start/approve/merge), and QA checklists.
- **schema-docs.mdc** — keep `docs/database/` in sync when `schema.ts` / migrations change.
- **`/worktask` skill** — [.cursor/skills/worktask/SKILL.md](.cursor/skills/worktask/SKILL.md): explicit Task Number → plan → `T####-*` branch → PROD task In Progress / Complete bookkeeping.

## Shared conventions (Phase 0+)

- **Entity types** — polymorphic ids use `EntityType` in [`src/lib/entityType.ts`](src/lib/entityType.ts) and [`client/src/lib/entityType.ts`](client/src/lib/entityType.ts) (`idea` | `project` | `task` | `document` | `todo_list` | `board` | `canvas` | `wiki_node`). Prefer `(entityType, entityId)` joins for tags/boards/wiki later.
- **Shared UI** — put reusable chrome under `client/src/components/shared/` (`ColorPopover`, `ElementShell`). Modes: `card` | `modal` | `page`.
- **Markdown** — shared TipTap `MarkdownEditor` (`client/src/components/shared/MarkdownEditor.tsx`); clipboard image paste → `/api/v1/uploads`.
- **Colors** — default 16-swatch palette in `client/src/lib/palette.ts`; store accents as CSS hex strings.
- **Design tokens** — see `client/src/index.css` (`--canvas-bg`, `--radius-chip`, `--focus-ring`, etc.).
- **Canvases** — Excalidraw (`@excalidraw/excalidraw`, MIT) in `CanvasEditor`; scene JSON in `canvases.document`. Fonts copied on client `postinstall` to `public/excalidraw-assets/`.
- **Command palette** — Ctrl/Cmd+K (Phase 9a); see `client/src/components/CommandPalette.tsx`.
- **Delivery** — at the end of every implementation pass, give the user a step-by-step **QA checklist** (features and flows to examine for approval or tweaks). **QA follow-ups** (new work or corrections during review): update the active plan, mention them in the commit message, and for `/worktask` post a PROD Task comment (also include them in the completion comment).
- **Feature git** — on start: branch `T####-short-slug` (worktask) or `phase-N-short-slug` (ad-hoc) from updated `main`. **Finish up** (user approval to close): commit → merge into `main` → push `main` → archive the plan under `.cursor/plans/executed/` (commit + push) → delete local/remote feature branch(es) → **`npm run deploy:prod`** (confirm `:3000` + nginx HTTPS health checks) → for `/worktask`, mark the PROD Task `complete` and add a completion comment.

## Common commands

| Goal | Command |
|------|---------|
| API + SPA dev (two processes) | `npm run dev:web` — UI **:5173**, DEV API **:3001** (PROD stays on **:3000** / nginx **:80**) |
| Dev API only | `npm run dev` |
| Production bundles | `npm run build:all` then `NODE_ENV=production npm start` |
| DB migrations | `npm run db:migrate` |
| After editing `src/db/schema.ts` | `npm run db:generate`, review `drizzle/`, then `npm run db:migrate`; update [docs/database/](docs/database/overview.md); `npm run docs:sync-schema` |
| Sync schema docs → TaskMesh Documents | `npm run docs:sync-schema` (PROD `:3000`, project id 4) |

Health check when running locally: `GET /api/health`.

Image uploads default to `data/uploads/` (see `.env.example` for `UPLOAD_DIR`). Back up that directory with Postgres dumps.
