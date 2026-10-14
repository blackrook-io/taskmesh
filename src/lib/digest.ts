export const DIGEST_SECTIONS = [
  "overdue",
  "at_risk",
  "stale",
  "blocked",
  "changed",
  "suggestions",
  "duplicates",
  "assigned_out",
] as const;

export type DigestSection = (typeof DIGEST_SECTIONS)[number];

export const DIGEST_ITEM_CAP = 25;

export function isDigestSection(value: string): value is DigestSection {
  return (DIGEST_SECTIONS as readonly string[]).includes(value);
}

export type DigestItem = {
  entityType: string;
  entityId: number;
  referenceId: string;
  title: string;
  projectId: number | null;
  /** Second record on a duplicate pair. Null for every other section. */
  alsoProjectId: number | null;
  reason: string;
  href: string;
};

export type DigestSections = Record<DigestSection, DigestItem[]>;

export type DigestCounts = Record<DigestSection, number>;

export type DigestEnabled = Record<DigestSection, boolean>;

export type DigestFrequency = "daily" | "weekly";

export type DigestPrefs = {
  frequency: DigestFrequency;
  sections: DigestEnabled;
  summary: boolean;
  timeZone: string;
  hour: number;
};

export function emptyDigestSections(): DigestSections {
  return {
    overdue: [],
    at_risk: [],
    stale: [],
    blocked: [],
    changed: [],
    suggestions: [],
    duplicates: [],
    assigned_out: [],
  };
}

export function emptyDigestCounts(): DigestCounts {
  return {
    overdue: 0,
    at_risk: 0,
    stale: 0,
    blocked: 0,
    changed: 0,
    suggestions: 0,
    duplicates: 0,
    assigned_out: 0,
  };
}

function isTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Empty or partial JSON uses daily, every section, summary on, UTC, hour 7. */
export function parseDigestPrefs(value: unknown): DigestPrefs {
  const raw = asRecord(value);
  const frequency = raw?.frequency === "weekly" ? "weekly" : "daily";
  const summary = raw?.summary === false ? false : true;
  const zone = typeof raw?.timeZone === "string" ? raw.timeZone : "";
  const timeZone = zone && isTimeZone(zone) ? zone : "UTC";
  const hourValue = raw?.hour;
  const hour =
    typeof hourValue === "number" && Number.isInteger(hourValue) && hourValue >= 0 && hourValue <= 23
      ? hourValue
      : 7;
  const stored = asRecord(raw?.sections);
  const sections = {} as DigestEnabled;
  for (const key of DIGEST_SECTIONS) {
    sections[key] = stored?.[key] === false ? false : true;
  }
  return { frequency, sections, summary, timeZone, hour };
}

export function isDigestItem(value: unknown): value is DigestItem {
  const raw = asRecord(value);
  if (!raw) return false;
  return (
    typeof raw.entityType === "string" &&
    typeof raw.entityId === "number" &&
    typeof raw.referenceId === "string" &&
    typeof raw.title === "string" &&
    typeof raw.reason === "string" &&
    typeof raw.href === "string" &&
    (raw.projectId === null || typeof raw.projectId === "number") &&
    (raw.alsoProjectId === null || typeof raw.alsoProjectId === "number")
  );
}

export function readDigestSections(value: unknown): DigestSections {
  const raw = asRecord(value);
  const sections = emptyDigestSections();
  for (const key of DIGEST_SECTIONS) {
    const list = raw?.[key];
    if (!Array.isArray(list)) continue;
    sections[key] = list.filter(isDigestItem);
  }
  return sections;
}

export function readDigestCounts(value: unknown): DigestCounts {
  const raw = asRecord(value);
  const counts = emptyDigestCounts();
  for (const key of DIGEST_SECTIONS) {
    const count = raw?.[key];
    counts[key] = typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : 0;
  }
  return counts;
}

export function readDigestEnabled(value: unknown): DigestEnabled {
  const raw = asRecord(value);
  const enabled = {} as DigestEnabled;
  for (const key of DIGEST_SECTIONS) {
    enabled[key] = raw?.[key] === false ? false : true;
  }
  return enabled;
}

/** First digest looks back to the start of the period. Later ones start at the previous row. */
export function changeWindowStart(previousGeneratedAt: Date | null, periodStart: Date): Date {
  return previousGeneratedAt ?? periodStart;
}

export function shouldSummarize(args: {
  enabled: boolean;
  featureOff: boolean;
  lineCount: number;
}): boolean {
  return args.enabled && !args.featureOff && args.lineCount > 0;
}

/** Lines the model may see. Excluded projects drop the whole item, including a duplicate's other title. */
export function summaryFactLines(sections: DigestSections, excluded: ReadonlySet<number>): string[] {
  const lines: string[] = [];
  for (const section of DIGEST_SECTIONS) {
    for (const item of sections[section]) {
      if (item.projectId != null && excluded.has(item.projectId)) continue;
      if (item.alsoProjectId != null && excluded.has(item.alsoProjectId)) continue;
      lines.push(`${section} ${item.referenceId} ${item.title} — ${item.reason}`);
    }
  }
  return lines;
}

export function readExcludedProjects(value: unknown): { id: number; name: string }[] {
  if (!Array.isArray(value)) return [];
  const projects: { id: number; name: string }[] = [];
  for (const row of value) {
    const raw = asRecord(row);
    if (!raw || typeof raw.id !== "number" || typeof raw.name !== "string") continue;
    projects.push({ id: raw.id, name: raw.name });
  }
  return projects;
}

export function withheldProjects(
  sections: DigestSections,
  access: ReadonlyMap<number, string>,
  names: ReadonlyMap<number, string>,
): { id: number; name: string }[] {
  const ids = new Set<number>();
  for (const section of DIGEST_SECTIONS) {
    for (const item of sections[section]) {
      for (const projectId of [item.projectId, item.alsoProjectId]) {
        if (projectId != null && access.get(projectId) === "excluded") ids.add(projectId);
      }
    }
  }
  return [...ids]
    .sort((a, b) => a - b)
    .map((id) => ({ id, name: names.get(id) ?? `Project ${id}` }));
}
