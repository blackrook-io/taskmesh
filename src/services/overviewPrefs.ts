import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import type { OverviewPanelInstance, OverviewPanelPref } from "../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

export const OVERVIEW_PANEL_TYPES = [
  "recently_completed_tasks",
  "next_tasks_due",
  "todos_overdue",
  "todos_upcoming",
  "my_tasks_today",
] as const;

export type OverviewPanelType = (typeof OVERVIEW_PANEL_TYPES)[number];

export const OVERVIEW_PANEL_LIMITS = [5, 10, 20] as const;
export type OverviewPanelLimit = (typeof OVERVIEW_PANEL_LIMITS)[number];

/** Panels that use a days window. */
export const OVERVIEW_PANELS_WITH_DAYS: ReadonlySet<OverviewPanelType> = new Set([
  "recently_completed_tasks",
  "todos_upcoming",
]);

/** Seed order for project default / legacy conversion (T0135 four). */
export const OVERVIEW_DEFAULT_PANEL_TYPES: readonly OverviewPanelType[] = [
  "recently_completed_tasks",
  "next_tasks_due",
  "todos_overdue",
  "todos_upcoming",
];

export const DEFAULT_OVERVIEW_PANEL_LIMIT: OverviewPanelLimit = 5;
export const DEFAULT_OVERVIEW_PANEL_DAYS = 14;

export function isOverviewPanelType(value: string): value is OverviewPanelType {
  return (OVERVIEW_PANEL_TYPES as readonly string[]).includes(value);
}

export function isOverviewPanelLimit(value: number): value is OverviewPanelLimit {
  return (OVERVIEW_PANEL_LIMITS as readonly number[]).includes(value);
}

export function defaultPrefForType(type: OverviewPanelType): OverviewPanelPref {
  if (OVERVIEW_PANELS_WITH_DAYS.has(type)) {
    return { limit: DEFAULT_OVERVIEW_PANEL_LIMIT, days: DEFAULT_OVERVIEW_PANEL_DAYS };
  }
  return { limit: DEFAULT_OVERVIEW_PANEL_LIMIT };
}

export function makePanelInstance(
  type: OverviewPanelType,
  pref?: Partial<OverviewPanelPref>,
  id: string = randomUUID(),
): OverviewPanelInstance {
  const base = defaultPrefForType(type);
  const limit = isOverviewPanelLimit(Number(pref?.limit))
    ? (Number(pref!.limit) as OverviewPanelLimit)
    : base.limit;
  if (OVERVIEW_PANELS_WITH_DAYS.has(type)) {
    const daysRaw = pref?.days;
    const days =
      typeof daysRaw === "number" && Number.isInteger(daysRaw) && daysRaw >= 1 && daysRaw <= 365
        ? daysRaw
        : (base.days ?? DEFAULT_OVERVIEW_PANEL_DAYS);
    return { id, type, limit, days };
  }
  return { id, type, limit };
}

/** Built-in seed layout (four T0135 panels). Fresh uuids each call. */
export function seedDefaultLayout(): OverviewPanelInstance[] {
  return OVERVIEW_DEFAULT_PANEL_TYPES.map((type) => makePanelInstance(type));
}

function clampInstance(raw: unknown): OverviewPanelInstance | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" && row.id.length > 0 ? row.id : null;
  const type = typeof row.type === "string" && isOverviewPanelType(row.type) ? row.type : null;
  if (!id || !type) return null;
  return makePanelInstance(type, { limit: row.limit as OverviewPanelLimit, days: row.days as number }, id);
}

/** Normalize stored jsonb: layout array or legacy key→prefs map. */
export function normalizeLayoutStored(
  stored: OverviewPanelInstance[] | Record<string, OverviewPanelPref> | null | undefined,
  defaultLayout?: OverviewPanelInstance[],
): OverviewPanelInstance[] | null {
  if (stored == null) return null;
  if (Array.isArray(stored)) {
    const out: OverviewPanelInstance[] = [];
    for (const item of stored) {
      const inst = clampInstance(item);
      if (inst) out.push(inst);
    }
    return out;
  }
  if (typeof stored === "object") {
    const seed = defaultLayout && defaultLayout.length > 0 ? defaultLayout : seedDefaultLayout();
    const out: OverviewPanelInstance[] = [];
    const usedTypes = new Set<string>();
    for (const base of seed) {
      if (!isOverviewPanelType(base.type)) continue;
      const pref = stored[base.type];
      out.push(makePanelInstance(base.type, pref, base.id));
      usedTypes.add(base.type);
    }
    for (const [key, pref] of Object.entries(stored)) {
      if (!isOverviewPanelType(key) || usedTypes.has(key)) continue;
      out.push(makePanelInstance(key, pref));
    }
    return out;
  }
  return null;
}

export function validateLayoutInput(input: unknown): OverviewPanelInstance[] {
  if (!Array.isArray(input)) {
    throw Object.assign(new Error("layout must be an array of panel instances"), {
      status: 400,
      code: "validation_error",
    });
  }
  if (input.length > 40) {
    throw Object.assign(new Error("layout may contain at most 40 panels"), {
      status: 400,
      code: "validation_error",
    });
  }
  const seen = new Set<string>();
  const out: OverviewPanelInstance[] = [];
  for (const item of input) {
    const inst = clampInstance(item);
    if (!inst) {
      throw Object.assign(new Error("Invalid overview panel instance"), {
        status: 400,
        code: "validation_error",
      });
    }
    if (seen.has(inst.id)) {
      throw Object.assign(new Error(`Duplicate panel id: ${inst.id}`), {
        status: 400,
        code: "validation_error",
      });
    }
    seen.add(inst.id);
    out.push(inst);
  }
  return out;
}

export async function getProjectOverviewDefault(
  db: Db,
  projectId: number,
): Promise<OverviewPanelInstance[]> {
  const [row] = await db
    .select()
    .from(schema.projectOverviewDefaults)
    .where(eq(schema.projectOverviewDefaults.projectId, projectId));
  if (!row) {
    const layout = seedDefaultLayout();
    try {
      await db.insert(schema.projectOverviewDefaults).values({
        projectId,
        layout,
        updatedById: null,
        updatedAt: new Date(),
      });
      return layout;
    } catch {
      const [again] = await db
        .select()
        .from(schema.projectOverviewDefaults)
        .where(eq(schema.projectOverviewDefaults.projectId, projectId));
      if (again) {
        const existing = normalizeLayoutStored(again.layout);
        if (existing && existing.length > 0) return existing;
      }
      return layout;
    }
  }
  const layout = normalizeLayoutStored(row.layout);
  return layout && layout.length > 0 ? layout : seedDefaultLayout();
}

export async function putProjectOverviewDefault(
  db: Db,
  projectId: number,
  layoutInput: unknown,
  updatedById: number | null,
): Promise<OverviewPanelInstance[]> {
  const layout = validateLayoutInput(layoutInput);
  const now = new Date();
  const [existing] = await db
    .select({ id: schema.projectOverviewDefaults.id })
    .from(schema.projectOverviewDefaults)
    .where(eq(schema.projectOverviewDefaults.projectId, projectId));
  if (existing) {
    await db
      .update(schema.projectOverviewDefaults)
      .set({ layout, updatedById, updatedAt: now })
      .where(eq(schema.projectOverviewDefaults.id, existing.id));
  } else {
    await db.insert(schema.projectOverviewDefaults).values({
      projectId,
      layout,
      updatedById,
      updatedAt: now,
    });
  }
  return layout;
}

export type OverviewPrefsResponse = {
  layout: OverviewPanelInstance[];
  customized: boolean;
  defaultLayout: OverviewPanelInstance[];
};

export async function getUserOverviewPrefs(
  db: Db,
  userId: number,
  projectId: number,
): Promise<OverviewPrefsResponse> {
  const defaultLayout = await getProjectOverviewDefault(db, projectId);
  const [row] = await db
    .select()
    .from(schema.userProjectOverviewPrefs)
    .where(
      and(
        eq(schema.userProjectOverviewPrefs.userId, userId),
        eq(schema.userProjectOverviewPrefs.projectId, projectId),
      ),
    );
  if (!row) {
    return { layout: defaultLayout, customized: false, defaultLayout };
  }
  const layout = normalizeLayoutStored(row.panels, defaultLayout) ?? defaultLayout;
  // Rewrite legacy map shape to instance array when needed.
  if (!Array.isArray(row.panels)) {
    await db
      .update(schema.userProjectOverviewPrefs)
      .set({ panels: layout, updatedAt: new Date() })
      .where(eq(schema.userProjectOverviewPrefs.id, row.id));
  }
  return { layout, customized: true, defaultLayout };
}

export async function putUserOverviewPrefs(
  db: Db,
  userId: number,
  projectId: number,
  layoutInput: unknown,
): Promise<OverviewPrefsResponse> {
  const layout = validateLayoutInput(layoutInput);
  const defaultLayout = await getProjectOverviewDefault(db, projectId);
  const now = new Date();
  const [existing] = await db
    .select({ id: schema.userProjectOverviewPrefs.id })
    .from(schema.userProjectOverviewPrefs)
    .where(
      and(
        eq(schema.userProjectOverviewPrefs.userId, userId),
        eq(schema.userProjectOverviewPrefs.projectId, projectId),
      ),
    );
  if (existing) {
    await db
      .update(schema.userProjectOverviewPrefs)
      .set({ panels: layout, updatedAt: now })
      .where(eq(schema.userProjectOverviewPrefs.id, existing.id));
  } else {
    await db.insert(schema.userProjectOverviewPrefs).values({
      userId,
      projectId,
      panels: layout,
      updatedAt: now,
    });
  }
  return { layout, customized: true, defaultLayout };
}

export async function resetUserOverviewPrefs(
  db: Db,
  userId: number,
  projectId: number,
): Promise<OverviewPrefsResponse> {
  await db
    .delete(schema.userProjectOverviewPrefs)
    .where(
      and(
        eq(schema.userProjectOverviewPrefs.userId, userId),
        eq(schema.userProjectOverviewPrefs.projectId, projectId),
      ),
    );
  const defaultLayout = await getProjectOverviewDefault(db, projectId);
  return { layout: defaultLayout, customized: false, defaultLayout };
}
