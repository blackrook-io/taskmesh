import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import type { ListViewColumnPref } from "../db/schema.js";
import { NotFoundError } from "../lib/notFound.js";

type Db = NodePgDatabase<typeof schema>;

export const LIST_VIEW_KEYS = ["tasks", "ideas"] as const;
export type ListViewKey = (typeof LIST_VIEW_KEYS)[number];

const LIST_VIEW_ENTITY: Record<ListViewKey, string> = {
  tasks: "task",
  ideas: "idea",
};

export function isListViewKey(value: string): value is ListViewKey {
  return (LIST_VIEW_KEYS as readonly string[]).includes(value);
}

export type EntityFieldRow = typeof schema.entityFields.$inferSelect;

export type ListViewFieldDto = {
  fieldKey: string;
  label: string;
  defaultVisible: boolean;
  defaultSortOrder: number;
  sortable: boolean;
  scope: string | null;
};

/** Merge stored prefs with displayable catalog; drop unknown keys; append missing at end. */
export function mergeColumnPrefs(
  displayable: EntityFieldRow[],
  stored: ListViewColumnPref[] | null | undefined,
): ListViewColumnPref[] {
  const byKey = new Map(displayable.map((f) => [f.fieldKey, f]));
  const seen = new Set<string>();
  const out: ListViewColumnPref[] = [];

  if (stored) {
    for (const col of stored) {
      if (!byKey.has(col.fieldKey) || seen.has(col.fieldKey)) continue;
      seen.add(col.fieldKey);
      out.push({ fieldKey: col.fieldKey, visible: Boolean(col.visible) });
    }
  }

  const missing = displayable
    .filter((f) => !seen.has(f.fieldKey))
    .sort((a, b) => a.defaultSortOrder - b.defaultSortOrder || a.id - b.id);
  for (const f of missing) {
    out.push({ fieldKey: f.fieldKey, visible: f.defaultVisible });
  }
  return out;
}

export function defaultColumnPrefs(displayable: EntityFieldRow[]): ListViewColumnPref[] {
  return mergeColumnPrefs(displayable, null);
}

export function validateColumnPrefsInput(
  displayable: EntityFieldRow[],
  input: ListViewColumnPref[],
): ListViewColumnPref[] {
  const allowed = new Set(displayable.map((f) => f.fieldKey));
  const seen = new Set<string>();
  const out: ListViewColumnPref[] = [];
  for (const col of input) {
    if (typeof col.fieldKey !== "string" || !allowed.has(col.fieldKey)) {
      throw Object.assign(new Error(`Unknown or non-displayable field: ${col.fieldKey}`), {
        status: 400,
        code: "validation_error",
      });
    }
    if (seen.has(col.fieldKey)) continue;
    seen.add(col.fieldKey);
    out.push({ fieldKey: col.fieldKey, visible: Boolean(col.visible) });
  }
  for (const f of displayable) {
    if (!seen.has(f.fieldKey)) {
      out.push({ fieldKey: f.fieldKey, visible: f.defaultVisible });
    }
  }
  return out;
}

export async function listDisplayableFields(
  db: Db,
  listViewKey: ListViewKey,
): Promise<EntityFieldRow[]> {
  const entityType = LIST_VIEW_ENTITY[listViewKey];
  return db
    .select()
    .from(schema.entityFields)
    .where(
      and(
        eq(schema.entityFields.entityType, entityType),
        eq(schema.entityFields.displayable, true),
      ),
    )
    .orderBy(asc(schema.entityFields.defaultSortOrder), asc(schema.entityFields.id));
}

export async function getListViewFields(
  db: Db,
  listViewKey: ListViewKey,
): Promise<ListViewFieldDto[]> {
  const rows = await listDisplayableFields(db, listViewKey);
  return rows.map((r) => ({
    fieldKey: r.fieldKey,
    label: r.label,
    defaultVisible: r.defaultVisible,
    defaultSortOrder: r.defaultSortOrder,
    sortable: r.sortable,
    scope: r.scope,
  }));
}

export async function getUserListViewPrefs(
  db: Db,
  userId: number,
  listViewKey: ListViewKey,
): Promise<{ columns: ListViewColumnPref[]; isDefault: boolean }> {
  const displayable = await listDisplayableFields(db, listViewKey);
  const [row] = await db
    .select()
    .from(schema.userListViewPrefs)
    .where(
      and(
        eq(schema.userListViewPrefs.userId, userId),
        eq(schema.userListViewPrefs.listViewKey, listViewKey),
      ),
    );
  if (!row) {
    return { columns: defaultColumnPrefs(displayable), isDefault: true };
  }
  return { columns: mergeColumnPrefs(displayable, row.columns), isDefault: false };
}

export async function putUserListViewPrefs(
  db: Db,
  userId: number,
  listViewKey: ListViewKey,
  columns: ListViewColumnPref[],
): Promise<{ columns: ListViewColumnPref[]; isDefault: boolean }> {
  const displayable = await listDisplayableFields(db, listViewKey);
  const validated = validateColumnPrefsInput(displayable, columns);
  const now = new Date();
  const [existing] = await db
    .select({ id: schema.userListViewPrefs.id })
    .from(schema.userListViewPrefs)
    .where(
      and(
        eq(schema.userListViewPrefs.userId, userId),
        eq(schema.userListViewPrefs.listViewKey, listViewKey),
      ),
    );
  if (existing) {
    await db
      .update(schema.userListViewPrefs)
      .set({ columns: validated, updatedAt: now })
      .where(eq(schema.userListViewPrefs.id, existing.id));
  } else {
    await db.insert(schema.userListViewPrefs).values({
      userId,
      listViewKey,
      columns: validated,
      updatedAt: now,
    });
  }
  return { columns: validated, isDefault: false };
}

export async function resetUserListViewPrefs(
  db: Db,
  userId: number,
  listViewKey: ListViewKey,
): Promise<{ columns: ListViewColumnPref[]; isDefault: boolean }> {
  if (!isListViewKey(listViewKey)) {
    throw new NotFoundError("Unknown list view");
  }
  await db
    .delete(schema.userListViewPrefs)
    .where(
      and(
        eq(schema.userListViewPrefs.userId, userId),
        eq(schema.userListViewPrefs.listViewKey, listViewKey),
      ),
    );
  const displayable = await listDisplayableFields(db, listViewKey);
  return { columns: defaultColumnPrefs(displayable), isDefault: true };
}
