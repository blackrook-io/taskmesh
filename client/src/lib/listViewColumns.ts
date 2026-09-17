/** List View column personalization (T0056) — shared types + grid helpers. */

export type ListViewKey = "tasks" | "ideas";

export type ListViewField = {
  fieldKey: string;
  label: string;
  defaultVisible: boolean;
  defaultSortOrder: number;
  sortable: boolean;
  scope: string | null;
};

export type ListViewColumnPref = {
  fieldKey: string;
  visible: boolean;
};

export type ListViewPrefsPayload = {
  columns: ListViewColumnPref[];
  isDefault: boolean;
};

export type ResolvedListColumn = ListViewField & { visible: boolean };

/** Surface filter for scope-restricted columns (e.g. Project on global only). */
export type ListViewSurface = "project" | "global" | "ideas";

const TASK_TRACK: Record<string, string> = {
  number: "6.75rem",
  title: "minmax(8rem, 1.4fr)",
  state: "7rem",
  assignee: "6.5rem",
  priority: "6.5rem",
  dueDate: "8rem",
  project: "minmax(5rem, 8rem)",
  phase: "7rem",
  tags: "minmax(6rem, 10rem)",
  createdAt: "7.5rem",
  updatedAt: "7.5rem",
  owner: "6.5rem",
  createdBy: "6.5rem",
};

const IDEA_TRACK: Record<string, string> = {
  title: "minmax(8rem, 1.5fr)",
  tags: "minmax(6rem, 1fr)",
  createdAt: "7rem",
  number: "5.5rem",
  updatedAt: "7rem",
  assignee: "6.5rem",
};

const TASK_CHROME = "6px 1.5rem 1.75rem";
const IDEA_CHROME_END = "4.5rem";

export function fieldAppliesToSurface(field: ListViewField, surface: ListViewSurface): boolean {
  if (field.scope == null) return true;
  if (field.scope === "global") return surface === "global";
  return field.scope === surface;
}

export function resolveVisibleColumns(
  fields: ListViewField[],
  prefs: ListViewColumnPref[],
  surface: ListViewSurface,
): ResolvedListColumn[] {
  const byKey = new Map(fields.map((f) => [f.fieldKey, f]));
  const out: ResolvedListColumn[] = [];
  for (const pref of prefs) {
    const field = byKey.get(pref.fieldKey);
    if (!field || !pref.visible) continue;
    if (!fieldAppliesToSurface(field, surface)) continue;
    out.push({ ...field, visible: true });
  }
  return out;
}

export function resolvePersonalizeRows(
  fields: ListViewField[],
  prefs: ListViewColumnPref[],
  surface: ListViewSurface,
): ResolvedListColumn[] {
  const byKey = new Map(fields.map((f) => [f.fieldKey, f]));
  const out: ResolvedListColumn[] = [];
  const seen = new Set<string>();
  for (const pref of prefs) {
    const field = byKey.get(pref.fieldKey);
    if (!field || seen.has(pref.fieldKey)) continue;
    if (!fieldAppliesToSurface(field, surface) && field.scope === "global" && surface === "project") {
      // Still show Project in Personalize on project surfaces so shared prefs stay editable;
      // it simply won't render until viewing global.
    }
    seen.add(pref.fieldKey);
    out.push({ ...field, visible: pref.visible });
  }
  for (const field of fields) {
    if (seen.has(field.fieldKey)) continue;
    out.push({ ...field, visible: field.defaultVisible });
  }
  return out;
}

export function buildTaskListGridTemplate(visible: ResolvedListColumn[], surface: ListViewSurface): string {
  const tracks = visible.map((c) => {
    if (c.fieldKey === "title" && surface === "global") return "minmax(8rem, 1.2fr)";
    return TASK_TRACK[c.fieldKey] ?? "minmax(5rem, 8rem)";
  });
  return `${TASK_CHROME} ${tracks.join(" ")}`;
}

export function buildIdeasListGridTemplate(visible: ResolvedListColumn[]): string {
  const tracks = visible.map((c) => IDEA_TRACK[c.fieldKey] ?? "minmax(5rem, 8rem)");
  return `${tracks.join(" ")} ${IDEA_CHROME_END}`;
}

export function formatListDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.slice(0, 10);
  return d || "—";
}
