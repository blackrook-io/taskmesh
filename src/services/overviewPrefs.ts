import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import type { OverviewPanelPref } from "../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

export const OVERVIEW_PANEL_KEYS = [
  "recently_completed_tasks",
  "next_tasks_due",
  "todos_overdue",
  "todos_upcoming",
] as const;

export type OverviewPanelKey = (typeof OVERVIEW_PANEL_KEYS)[number];

export const OVERVIEW_PANEL_LIMITS = [5, 10, 20] as const;
export type OverviewPanelLimit = (typeof OVERVIEW_PANEL_LIMITS)[number];

/** Panels that use a days window. */
export const OVERVIEW_PANELS_WITH_DAYS: ReadonlySet<OverviewPanelKey> = new Set([
  "recently_completed_tasks",
  "todos_upcoming",
]);

export const DEFAULT_OVERVIEW_PANEL_LIMIT: OverviewPanelLimit = 5;
export const DEFAULT_OVERVIEW_PANEL_DAYS = 14;

export function isOverviewPanelKey(value: string): value is OverviewPanelKey {
  return (OVERVIEW_PANEL_KEYS as readonly string[]).includes(value);
}

export function isOverviewPanelLimit(value: number): value is OverviewPanelLimit {
  return (OVERVIEW_PANEL_LIMITS as readonly number[]).includes(value);
}

export function defaultPanelPref(key: OverviewPanelKey): OverviewPanelPref {
  if (OVERVIEW_PANELS_WITH_DAYS.has(key)) {
    return { limit: DEFAULT_OVERVIEW_PANEL_LIMIT, days: DEFAULT_OVERVIEW_PANEL_DAYS };
  }
  return { limit: DEFAULT_OVERVIEW_PANEL_LIMIT };
}

export function defaultOverviewPanels(): Record<OverviewPanelKey, OverviewPanelPref> {
  const out = {} as Record<OverviewPanelKey, OverviewPanelPref>;
  for (const key of OVERVIEW_PANEL_KEYS) {
    out[key] = defaultPanelPref(key);
  }
  return out;
}

/** Merge stored prefs with defaults; drop unknown keys; clamp values. */
export function mergeOverviewPanels(
  stored: Record<string, OverviewPanelPref> | null | undefined,
): Record<OverviewPanelKey, OverviewPanelPref> {
  const out = defaultOverviewPanels();
  if (!stored) return out;
  for (const key of OVERVIEW_PANEL_KEYS) {
    const row = stored[key];
    if (!row || typeof row !== "object") continue;
    const limit = isOverviewPanelLimit(Number(row.limit))
      ? (Number(row.limit) as OverviewPanelLimit)
      : DEFAULT_OVERVIEW_PANEL_LIMIT;
    if (OVERVIEW_PANELS_WITH_DAYS.has(key)) {
      const daysRaw = row.days;
      const days =
        typeof daysRaw === "number" && Number.isInteger(daysRaw) && daysRaw >= 1 && daysRaw <= 365
          ? daysRaw
          : DEFAULT_OVERVIEW_PANEL_DAYS;
      out[key] = { limit, days };
    } else {
      out[key] = { limit };
    }
  }
  return out;
}

export function validateOverviewPanelsInput(
  input: Record<string, OverviewPanelPref>,
): Record<OverviewPanelKey, OverviewPanelPref> {
  const base = defaultOverviewPanels();
  for (const [rawKey, row] of Object.entries(input)) {
    if (!isOverviewPanelKey(rawKey)) {
      throw Object.assign(new Error(`Unknown overview panel: ${rawKey}`), {
        status: 400,
        code: "validation_error",
      });
    }
    if (!row || typeof row !== "object") {
      throw Object.assign(new Error(`Invalid prefs for panel: ${rawKey}`), {
        status: 400,
        code: "validation_error",
      });
    }
    if (!isOverviewPanelLimit(Number(row.limit))) {
      throw Object.assign(new Error(`Invalid limit for panel: ${rawKey}`), {
        status: 400,
        code: "validation_error",
      });
    }
    const limit = Number(row.limit) as OverviewPanelLimit;
    if (OVERVIEW_PANELS_WITH_DAYS.has(rawKey)) {
      const days = row.days;
      if (
        days !== undefined &&
        !(typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 365)
      ) {
        throw Object.assign(new Error(`Invalid days for panel: ${rawKey}`), {
          status: 400,
          code: "validation_error",
        });
      }
      base[rawKey] = {
        limit,
        days: typeof days === "number" ? days : DEFAULT_OVERVIEW_PANEL_DAYS,
      };
    } else {
      base[rawKey] = { limit };
    }
  }
  return base;
}

/** Partial update: merge only provided panel keys into existing (or defaults). */
export function mergePartialOverviewPanels(
  existing: Record<OverviewPanelKey, OverviewPanelPref>,
  partial: Record<string, OverviewPanelPref>,
): Record<OverviewPanelKey, OverviewPanelPref> {
  const next = { ...existing };
  for (const [rawKey, row] of Object.entries(partial)) {
    if (!isOverviewPanelKey(rawKey)) {
      throw Object.assign(new Error(`Unknown overview panel: ${rawKey}`), {
        status: 400,
        code: "validation_error",
      });
    }
    const validated = validateOverviewPanelsInput({ [rawKey]: row });
    next[rawKey] = validated[rawKey];
  }
  return next;
}

export async function getUserOverviewPrefs(
  db: Db,
  userId: number,
  projectId: number,
): Promise<{ panels: Record<OverviewPanelKey, OverviewPanelPref>; isDefault: boolean }> {
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
    return { panels: defaultOverviewPanels(), isDefault: true };
  }
  return { panels: mergeOverviewPanels(row.panels), isDefault: false };
}

export async function putUserOverviewPrefs(
  db: Db,
  userId: number,
  projectId: number,
  panelsInput: Record<string, OverviewPanelPref>,
  mode: "replace" | "merge" = "merge",
): Promise<{ panels: Record<OverviewPanelKey, OverviewPanelPref>; isDefault: boolean }> {
  const current = await getUserOverviewPrefs(db, userId, projectId);
  const panels =
    mode === "replace"
      ? validateOverviewPanelsInput(panelsInput)
      : mergePartialOverviewPanels(current.panels, panelsInput);
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
      .set({ panels, updatedAt: now })
      .where(eq(schema.userProjectOverviewPrefs.id, existing.id));
  } else {
    await db.insert(schema.userProjectOverviewPrefs).values({
      userId,
      projectId,
      panels,
      updatedAt: now,
    });
  }
  return { panels, isDefault: false };
}
