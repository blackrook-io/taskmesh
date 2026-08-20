# TaskMesh documentation

Administrator and developer reference docs for this repository. These files are **git-tracked** and meant to stay accurate as the product evolves.

## Database schema

Authoritative Drizzle definitions live in [`src/db/schema.ts`](../src/db/schema.ts). Human-readable schema docs:

| Page | Contents |
|------|----------|
| [Database overview](database/overview.md) | Conceptual model, high-level ERD, how to read the docs |
| [Projects and ideas](database/projects-and-ideas.md) | `ideas`, `projects`, `task_groups` |
| [Tasks](database/tasks.md) | `tasks`, activity, dependencies, description templates |
| [Content and modules](database/content-and-modules.md) | Documents, uploads, tags, todos, boards, wiki, canvases, image boards |
| [Platform tables](database/platform.md) | Non-main inventory: users, API keys, system properties, request logs |
| [Glossary](database/glossary.md) | Display numbers, entity types, states, polymorphic joins |

### Keeping schema docs current

Whenever development changes the database (new tables/columns, constraint or relationship changes, or migrations from `schema.ts`), update the matching pages under `docs/database/` in the **same change set**, then **copy-replace** into the TaskMesh project’s Documents:

```bash
npm run docs:sync-schema
```

`/docs` is authoritative. The script upserts PROD Documents by stable titles (see `src/scripts/syncSchemaDocsToProject.ts`). Agents must follow [`.cursor/rules/schema-docs.mdc`](../.cursor/rules/schema-docs.mdc).
