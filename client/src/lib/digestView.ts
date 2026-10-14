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

export const DIGEST_SECTION_LABELS: Record<DigestSection, string> = {
  overdue: "Overdue",
  at_risk: "At risk",
  stale: "Stale",
  blocked: "Blocked",
  changed: "Changed",
  suggestions: "Suggestions",
  duplicates: "Duplicates",
  assigned_out: "Assigned to others",
};

export type DigestItem = {
  entityType: string;
  entityId: number;
  referenceId: string;
  title: string;
  projectId: number | null;
  alsoProjectId: number | null;
  reason: string;
  href: string;
};

export type DigestPrefs = {
  frequency: "daily" | "weekly";
  sections: Record<DigestSection, boolean>;
  summary: boolean;
  timeZone: string;
  hour: number;
};

export type DigestInbox = {
  digest: {
    id: number;
    periodKey: string;
    frequency: "daily" | "weekly";
    timeZone: string;
    generatedAt: string;
    sections: Record<DigestSection, DigestItem[]>;
    counts: Record<DigestSection, number>;
    summary: string | null;
    summarySource: "model" | null;
    excludedProjects: { id: number; name: string }[];
  } | null;
  hidden: Record<DigestSection, number>;
  unread: boolean;
  prefs: DigestPrefs;
};

export function remainingCount(inbox: DigestInbox, section: DigestSection): number {
  if (!inbox.digest) return 0;
  const shown = inbox.digest.sections[section].length;
  const hidden = inbox.hidden[section] ?? 0;
  return Math.max(0, inbox.digest.counts[section] - shown - hidden);
}
