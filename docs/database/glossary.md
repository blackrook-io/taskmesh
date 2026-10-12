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
| G | `groups` | G0001 |
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

**Note (T0097):** A ToDo may have a `parent_id`. Parents show a derived **x of y** completion rollup instead of a typed percent. Pending means the parent was marked complete while a sub-item was still open.

**Note (T0091 / T0119):** `project_documents.kind` is `markdown` (default), `epub`, or `pdf` (binary file via `upload_id` → `uploads` on disk).

**Note (T0207):** PDF and EPUB text is stored in `document_text_spans` (one row per page or chapter). `document_extractions.status` is `pending`, `ready`, `empty`, or `failed`. `empty` means the file had no text layer. OCR is not performed.
## Polymorphic entity links

Several tables store **`entity_type`** (text) + **`entity_id`** (integer) instead of a typed foreign key:

- `taggings`
- `todo_list_items`
- `board_cards`
- `wiki_nodes`
- `entity_links` (`src_type` / `src_id` and `dst_type` / `dst_id`)

Canonical `entity_type` values (`EntityType`):

`idea` · `project` · `task` · `todo` · `document` · `todo_list` · `board` · `canvas` · `wiki_node` · `image_board`

There is **no database FK** enforcing that `entity_id` exists in the target table; integrity is an application concern. Unique indexes usually prevent duplicate attachments of the same entity in the same parent (tag, list, board, or project wiki). `entity_links` is unique on the full directed pair plus relation and origin. Hard-deleting either end purges matching rows via triggers.

## Entity link relation and origin

`entity_links.relation`: `relates_to` (default) · `references` · `supports` · `part_of`.

`entity_links.origin`: `manual` (API create/delete) · `mention` (reserved for markdown sync). The same pair may exist once per origin. Soft-deleted tasks and todos keep their link rows; list APIs hide those ends until the record is restored.

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

Every row also has `entity_type` and `entity_id`. `task_id` is set only for tasks. Mesh last-update fields are `state`, `progress`, `status`, and document `body` (no diff stored). A comment is separate from that update.

`source`: `ui` when the SPA identifies itself; `ai` when an assistant proposal is applied; otherwise `api`.

## AI output feedback (T0211)

`ai_output_feedback.kind`:

- **`thumb_up` / `thumb_down`** — one row per audit row and user. A later thumb replaces the earlier one and its optional note (max 500 characters).
- **`accept` / `dismiss` / `undo`** — one row per audit row and kind. A repeat is ignored. Apply records `accept`. Dismiss records `dismiss`. `undo` is stored when a feature posts it; the assistant has no undo action yet.

## Project role lists (T0127 / T0128)

Tables: `project_managers`, `project_members`, `project_viewers`.

- **Owner** (`projects.owner_id`) is an implicit Manager (not duplicated in `project_managers`).
- **Assignee** (`tasks.assignee_id` / `todos.assignee_id`, T0117) is distinct from record **owner**. For project-scoped rows the assignee must be the Project Owner, a Manager, or a Member (not a Viewer). Unscoped rows and Ideas stay unassigned.
- A user may be in at most one list per project (application rule).
- Administrators are not listed; they already have full access.
- **Access (T0128):** Managers / Owner = read/write + Project Settings; Members = read/write; Viewers = read-only. Administrators always override. Delete project remains Administrator-only.
- Removing a Manager or Member who still has project Tasks/ToDos assigned to them requires **reassign** (to another Owner/Manager/Member) or **blank** (`assignee_id` null) before the role row is deleted.

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
| **RESTRICT** | Prevent deleting a user who still owns or authors records (`owner_id`, `created_by` / `updated_by`) |

Exact FK lists are on the domain pages.

## JSON documents

- **`canvases.document`** — Excalidraw scene JSON
- **`image_boards.document`** — image-board scene JSON (camera, items, …)
- **`system_properties.value`** — arbitrary jsonb config values
- **`system_properties` keys (current app)** —
  - `api_rate_limit_per_minute` — number
  - `global_api_rate_limit_per_minute` — number (default **300**, range **10**–**100000**; ceiling per user, API key, or IP on `/api/v1`)
  - `search_rate_limit_per_minute` — number (default **60**, range **10**–**100000**; ceiling per user, API key, or IP for global search)
  - `login_failure_threshold` — number (default **3**; locks account after failed sign-in attempts)
  - `session_timeout_minutes` — number (default **60**; cookie lifetime and absolute session lifetime)
  - `max_concurrent_sessions` — number (default **1**, range **1**–**20**; live browser sessions kept per user when a new session is created)
  - `default_theme` — accent theme string: `green` \| `blue` \| `orange` \| `yellow` \| `purple` \| `red` (default `green`). Personal UI preference in the browser overrides this until cleared.
  - `mfa_enforcement` — `none` \| `administrators` (default `none`; T0139)
  - `mfa_grace_days` — number of days (default **7**) before MFA-deadline lock when enforcement applies
  - `mfa_trusted_device_days` — trust duration in days (default **15**; `0` disables; T0141)
  - `mfa_trusted_device_max` — max trusted devices per user (default **5**; T0141)
  - `mesh_appearance` — jsonb object (T0175): colors for each record type, the AI suggestion, and overdue / at-risk / stale signals; line weights for tree, references, depends-on, and suggested edges; glyph scale, label size, badge size, label halo, overdue pulse, and stale threshold in days. Invalid fields fall back to the built-in Mesh defaults. Priority and state colors are not stored here.
  - `ai_providers` — jsonb map of provider plugin id → `{ enabled, config }`. `config` holds the public https base URL and default model. API keys are not stored in this property.
  - `ai_key_mode` — `instance_only` \| `user_only` \| `user_preferred_instance_fallback` (default `instance_only`, T0182). Controls who may spend an instance provider key. Missing or invalid values fall back to `instance_only`. The billing-risk acknowledgement is an `ai_audit_log` row, not a value on this key.
  - `ai_permission_tiers` — jsonb permission ceiling (T0185): `matrix` of action (or `action:entityType`) → tier 0–3, `tier1Enabled` (default true), `maxRecords` (default **5**), `maxProjects` (default **2**). Missing or invalid JSON uses those defaults. User opt-in is not stored on this key.
  - `ai_project_access_default` — `full` \| `read_only` \| `excluded` (default `full`, T0184). Instance ceiling for `projects.ai_access`. Projects can only narrow it. Missing or invalid values fall back to `full`.
  - `ai_feature_routes` — jsonb (T0205): `features` maps a feature id to an optional `{ pluginId, model }` default and an ordered `fallbacks` list; `profiles` is a list of per-model overrides (`tools`, `embeddings`, `longContext`, `size`). Missing or invalid JSON is treated as empty. API keys are not stored here.
- **`mesh_layouts.positions`** — pinned Mesh node key → `{ x, y }` (T0165). **`mesh_layouts.viewport`** — `{ x, y, zoom }` or empty. `view` is `focus` \| `plan`.

## Uploads vs database

`uploads` stores file metadata. Binary content lives on disk under `UPLOAD_DIR` (see `.env.example`). Back up Postgres dumps and the uploads directory together.

## Timestamps and dates

- `created_at` / `updated_at` — `timestamptz`
- `tasks.due_date` — calendar date only
- `tasks.due_at` — deprecated timestamp; prefer `due_date`

## Indexes and uniqueness

Beyond primary keys, most uniqueness is declared as named **UNIQUE** constraints in Drizzle (for example pair uniqueness on dependencies, polymorphic attachment uniqueness). There are few standalone non-unique indexes in `schema.ts`; if a migration adds indexes not reflected in the Drizzle table helpers, document them on the affected domain page when they matter operationally.
