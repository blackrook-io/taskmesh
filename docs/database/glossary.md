# Schema glossary

Shared vocabulary for TaskMesh database docs. Prefer this page over repeating definitions on every domain page.

## Source of truth

| Concern | Location |
|---------|----------|
| Table / column definitions | [`src/db/schema.ts`](../../src/db/schema.ts) |
| Polymorphic entity type strings | [`src/lib/entityType.ts`](../../src/lib/entityType.ts) (mirrored under `client/src/lib/entityType.ts`) |
| Migrations | [`drizzle/`](../../drizzle/) |
| Human-readable schema docs | [`docs/database/`](./) |

## Display numbers

Most user-facing entities store an app-wide unique integer `number` and format it with a letter prefix in the UI / APIs:

| Prefix | Table | Example |
|--------|-------|---------|
| I | `ideas` | I0042 |
| P | `projects` | P0007 |
| U | `users` | U0001 |
| T | `tasks` | T0065 |
| D | `todos` | D0012 |
| N | `project_documents` | N0012 |
| L | `todo_lists` | L0003 |
| B | `boards` | B0001 |
| W | `wiki_nodes` | W0008 |
| C | `canvases` | C0004 |
| M | `image_boards` | M0002 |

Internal joins still use surrogate `id` primary keys. Display numbers are for humans and stable references in conversation (for example `/worktask T0065`).

**Note (T0104):** ToDo items use **D####**. Project documents moved from D to **N####**.

## Polymorphic entity links

Several tables store **`entity_type`** (text) + **`entity_id`** (integer) instead of a typed foreign key:

- `taggings`
- `todo_list_items`
- `board_cards`
- `wiki_nodes`

Canonical `entity_type` values (`EntityType`):

`idea` · `project` · `task` · `todo` · `document` · `todo_list` · `board` · `canvas` · `wiki_node` · `image_board`

There is **no database FK** enforcing that `entity_id` exists in the target table; integrity is an application concern. Unique indexes usually prevent duplicate attachments of the same entity in the same parent (tag, list, board, or project wiki).

## Task states

Stored on `tasks.state` (text). API values and typical UI labels:

| API value | UI label (approx.) |
|-----------|-------------------|
| `new` | Draft |
| `ready` | Ready |
| `in_progress` | In Progress |
| `pending` | Pending (own work done; waiting on child tasks; stays in working lists) |
| `complete` | Complete |
| `canceled` | Canceled |
| `on_hold` | On Hold |
| `deleted` | Deleted (soft-delete; hidden from normal lists; not selectable in UI) |

Default for new rows: `new`. Soft-delete sets `deleted` instead of removing the row (preserves Task numbers and references).

**Pending:** Completing a task that still has unfinished direct children is stored as `pending` instead of `complete`. When every direct child is `complete`, `canceled`, or `deleted`, a Pending parent is set to `complete` (ancestors too). Pending does not block Depends-on.

## Task priority

`tasks.priority`: `none` (default) · `low` · `medium` · `high` · `urgent`.

## Task activity kinds

`task_activity.kind`:

- **`comment`** — user Markdown in `body`; may set `edited_at`
- **`change`** — field change with `field` / `old_value` / `new_value`; session summaries use `field = summary` with text in `body`

`source`: `ui` when the SPA identifies itself; otherwise `api`.

## Dependencies vs hierarchy

- **`tasks.parent_id`** — subtask tree (hierarchy)
- **`task_dependencies`** — blocking “Depends on” / “Required by” edges between tasks

Do not conflate the two.

## Roles

`roles.slug` is unique. Seeded system role: **`administrator`** (name Administrator, `is_system`). Custom role slugs are derived from the name. Administration access is granted only by the administrator role (T0108). Membership is `user_roles`.

## Foreign-key delete behaviors (summary)

| Pattern | Typical meaning |
|---------|-----------------|
| **CASCADE** | Child rows disappear with the parent (project-owned content, board children, activity, …) |
| **SET NULL** | Optional link cleared (parent task, source idea, avatar, optional image-board project, …) |
| **RESTRICT** | Prevent deleting a user who still authors tasks (`created_by` / `updated_by`) |

Exact FK lists are on the domain pages.

## JSON documents

- **`canvases.document`** — Excalidraw scene JSON
- **`image_boards.document`** — image-board scene JSON (camera, items, …)
- **`system_properties.value`** — arbitrary jsonb config values
- **`system_properties` keys (current app)** —
  - `api_rate_limit_per_minute` — number
  - `login_failure_threshold` — number (default **3**; locks account after failed sign-in attempts)
  - `session_timeout_minutes` — number (default **60**; cookie lifetime and future idle timeout)
  - `default_theme` — accent theme string: `green` \| `blue` \| `orange` \| `yellow` \| `purple` \| `red` (default `green`). Personal UI preference in the browser overrides this until cleared.

## Uploads vs database

`uploads` stores file metadata. Binary content lives on disk under `UPLOAD_DIR` (see `.env.example`). Back up Postgres dumps and the uploads directory together.

## Timestamps and dates

- `created_at` / `updated_at` — `timestamptz`
- `tasks.due_date` — calendar date only
- `tasks.due_at` — deprecated timestamp; prefer `due_date`

## Indexes and uniqueness

Beyond primary keys, most uniqueness is declared as named **UNIQUE** constraints in Drizzle (for example pair uniqueness on dependencies, polymorphic attachment uniqueness). There are few standalone non-unique indexes in `schema.ts`; if a migration adds indexes not reflected in the Drizzle table helpers, document them on the affected domain page when they matter operationally.
