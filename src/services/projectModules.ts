import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

export const PROJECT_MODULE_KEYS = [
  "tasks",
  "documents",
  "todo_lists",
  "boards",
  "wiki",
  "canvases",
] as const;

export type ProjectModuleKey = (typeof PROJECT_MODULE_KEYS)[number];

export function isProjectModuleKey(value: string): value is ProjectModuleKey {
  return (PROJECT_MODULE_KEYS as readonly string[]).includes(value);
}

/** Defaults: core modules on; future modules off until enabled. */
const DEFAULT_MODULES: { key: ProjectModuleKey; enabled: boolean; sortOrder: number }[] = [
  { key: "tasks", enabled: true, sortOrder: 0 },
  { key: "todo_lists", enabled: true, sortOrder: 1 },
  { key: "documents", enabled: true, sortOrder: 2 },
  { key: "boards", enabled: false, sortOrder: 3 },
  { key: "wiki", enabled: false, sortOrder: 4 },
  { key: "canvases", enabled: false, sortOrder: 5 },
];

/** Ensure every known module row exists for a project; insert missing with defaults. */
export async function ensureProjectModules(db: Db, projectId: number): Promise<void> {
  const existing = await db
    .select({ moduleKey: schema.projectModules.moduleKey })
    .from(schema.projectModules)
    .where(eq(schema.projectModules.projectId, projectId));
  const have = new Set(existing.map((r) => r.moduleKey));

  for (const def of DEFAULT_MODULES) {
    if (have.has(def.key)) continue;
    await db.insert(schema.projectModules).values({
      projectId,
      moduleKey: def.key,
      enabled: def.enabled,
      sortOrder: def.sortOrder,
    });
  }
}

export async function listProjectModules(db: Db, projectId: number) {
  await ensureProjectModules(db, projectId);
  return db
    .select()
    .from(schema.projectModules)
    .where(eq(schema.projectModules.projectId, projectId))
    .orderBy(asc(schema.projectModules.sortOrder), asc(schema.projectModules.id));
}

export async function setModuleEnabled(
  db: Db,
  projectId: number,
  moduleKey: ProjectModuleKey,
  enabled: boolean,
) {
  await ensureProjectModules(db, projectId);
  const [row] = await db
    .update(schema.projectModules)
    .set({ enabled, updatedAt: new Date() })
    .where(
      and(
        eq(schema.projectModules.projectId, projectId),
        eq(schema.projectModules.moduleKey, moduleKey),
      ),
    )
    .returning();
  return row ?? null;
}
