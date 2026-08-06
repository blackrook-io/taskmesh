# Agent guidance (TaskMesh)

This repo is a **Node.js + TypeScript** API (**Express**, **PostgreSQL**, **Drizzle ORM**) plus a **Vite + React** SPA in `client/`. Authoritative Ubuntu install and `DATABASE_URL` setup live in [INSTALL.md](INSTALL.md); product overview and scripts in [README.md](README.md).

## Cursor rules

Persistent product and engineering context is under [.cursor/rules/](.cursor/rules/):

- **platform-rules.mdc** — product vision, stack, UI, security (always applied).
- **coding-rules.mdc** — code quality expectations when editing `**/*.ts`.
- **development-rules.mdc** — plan files under `.cursor/plans/`, archive to `executed/`, phase git workflow (start/approve/merge), and phase-end QA checklists.

## Shared conventions (Phase 0+)

- **Entity types** — polymorphic ids use `EntityType` in [`src/lib/entityType.ts`](src/lib/entityType.ts) and [`client/src/lib/entityType.ts`](client/src/lib/entityType.ts) (`idea` | `project` | `task` | `document` | `todo_list` | `board` | `canvas` | `wiki_node`). Prefer `(entityType, entityId)` joins for tags/boards/wiki later.
- **Shared UI** — put reusable chrome under `client/src/components/shared/` (`ColorPopover`, `ElementShell`). Modes: `card` | `modal` | `page`.
- **Markdown** — shared TipTap `MarkdownEditor` (`client/src/components/shared/MarkdownEditor.tsx`); clipboard image paste → `/api/v1/uploads`.
- **Colors** — default 16-swatch palette in `client/src/lib/palette.ts`; store accents as CSS hex strings.
- **Design tokens** — see `client/src/index.css` (`--canvas-bg`, `--radius-chip`, `--focus-ring`, etc.).
- **Canvases** — Excalidraw (`@excalidraw/excalidraw`, MIT) in `CanvasEditor`; scene JSON in `canvases.document`. Fonts copied on client `postinstall` to `public/excalidraw-assets/`.
- **Command palette** — Ctrl/Cmd+K (Phase 9a); see `client/src/components/CommandPalette.tsx`.
- **Phase delivery** — at the end of every implementation phase, give the user a step-by-step **QA checklist** (features and flows to examine for approval or tweaks).
- **Phase git** — on phase start: branch `phase-N-short-slug` from updated `main`. **Finish up** (user approval to close): commit → merge into `main` → push `main` → archive the plan under `.cursor/plans/executed/` (commit + push) → delete local/remote phase branch(es).

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
