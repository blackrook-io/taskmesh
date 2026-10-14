import { stateLabel } from "./entityActivity.js";
import {
  DIGEST_ITEM_CAP,
  DIGEST_SECTIONS,
  emptyDigestCounts,
  emptyDigestSections,
  type DigestCounts,
  type DigestEnabled,
  type DigestItem,
  type DigestSections,
} from "./digest.js";
import { digestSchedule, digestStale } from "./digestSignals.js";

export type DigestAudience = "action" | "assigned_out" | "container";

export type DigestSubject = {
  entityType: string;
  entityId: number;
  referenceId: string;
  title: string;
  projectId: number | null;
  href: string;
  state: string | null;
  progress: number | null;
  dueDate: string | null;
  createdAt: string | null;
  signalAt: string | null;
  audience: DigestAudience;
  assigneeName: string | null;
};

export type DigestChange = {
  entityType: string;
  entityId: number;
  at: string;
  reason: string;
};

export type DigestNotice = {
  entityType: string;
  entityId: number;
  referenceId: string;
  title: string;
  projectId: number | null;
  alsoProjectId?: number | null;
  href: string;
  reason: string;
  score?: number;
};

function itemOf(subject: DigestSubject, reason: string, alsoProjectId: number | null = null): DigestItem {
  return {
    entityType: subject.entityType,
    entityId: subject.entityId,
    referenceId: subject.referenceId,
    title: subject.title,
    projectId: subject.projectId,
    alsoProjectId,
    reason,
    href: subject.href,
  };
}

function noticeItem(notice: DigestNotice): DigestItem {
  return {
    entityType: notice.entityType,
    entityId: notice.entityId,
    referenceId: notice.referenceId,
    title: notice.title,
    projectId: notice.projectId,
    alsoProjectId: notice.alsoProjectId ?? null,
    reason: notice.reason,
    href: notice.href,
  };
}

function keyOf(entityType: string, entityId: number): string {
  return `${entityType}:${entityId}`;
}

function take(list: DigestItem[], enabled: boolean): { items: DigestItem[]; count: number } {
  if (!enabled) return { items: [], count: 0 };
  return { items: list.slice(0, DIGEST_ITEM_CAP), count: list.length };
}

function assignedReason(subject: DigestSubject, overdue: boolean): string {
  const who = subject.assigneeName?.trim() || "someone else";
  const state = subject.state ? stateLabel(subject.state) : "Open";
  const due = overdue ? " · overdue" : "";
  return `Assigned to ${who} · ${state}${due}`;
}

/**
 * Split records into digest sections. Assigned-out work stays out of the action sections
 * and is listed last. A section that is off contributes nothing.
 */
export function classifyDigest(args: {
  subjects: readonly DigestSubject[];
  changes: readonly DigestChange[];
  suggestions: readonly DigestNotice[];
  duplicates: readonly DigestNotice[];
  now: Date;
  timeZone: string;
  staleDays: number;
  since: Date;
  enabled: DigestEnabled;
}): { sections: DigestSections; counts: DigestCounts } {
  const overdue: Array<{ days: number; item: DigestItem }> = [];
  const atRisk: Array<{ used: number; item: DigestItem }> = [];
  const stale: Array<{ signalAt: string; item: DigestItem }> = [];
  const blocked: Array<{ due: string; title: string; item: DigestItem }> = [];
  const assigned: Array<{ rank: number; title: string; item: DigestItem }> = [];
  const byKey = new Map<string, DigestSubject>();

  for (const subject of args.subjects) {
    byKey.set(keyOf(subject.entityType, subject.entityId), subject);
    if (subject.audience === "assigned_out") {
      const schedule = digestSchedule(subject, args.now, args.timeZone);
      const closed = subject.state === "complete" || subject.state === "canceled";
      const rank = subject.state === "blocked" ? 0 : schedule.kind === "overdue" ? 1 : closed ? 3 : 2;
      assigned.push({
        rank,
        title: subject.title,
        item: itemOf(subject, assignedReason(subject, schedule.kind === "overdue")),
      });
      continue;
    }
    const schedule = digestSchedule(subject, args.now, args.timeZone);
    if (subject.audience === "action" && schedule.kind === "overdue") {
      const days = schedule.days ?? 0;
      overdue.push({
        days,
        item: itemOf(subject, days === 1 ? "Due 1 day ago" : `Due ${days} days ago`),
      });
    }
    if (subject.audience === "action" && schedule.kind === "risk") {
      atRisk.push({
        used: schedule.used ?? 0,
        item: itemOf(
          subject,
          `${schedule.days ?? 0} days left, ${schedule.used ?? 0}% of the span used`,
        ),
      });
    }
    if (digestStale(subject, args.now, args.staleDays)) {
      const elapsed = Math.floor((args.now.getTime() - new Date(subject.signalAt ?? 0).getTime()) / 864e5);
      stale.push({
        signalAt: subject.signalAt ?? "",
        item: itemOf(subject, `No update in ${elapsed} days`),
      });
    }
    if (subject.audience === "action" && subject.state === "blocked") {
      blocked.push({
        due: subject.dueDate ?? "9999-99-99",
        title: subject.title,
        item: itemOf(subject, "Blocked"),
      });
    }
  }

  overdue.sort((a, b) => b.days - a.days);
  atRisk.sort((a, b) => b.used - a.used);
  stale.sort((a, b) => (a.signalAt < b.signalAt ? -1 : 1));
  blocked.sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
  const changedSeen = new Set<string>();
  const changed: DigestItem[] = [];
  const orderedChanges = [...args.changes].sort((a, b) => (a.at < b.at ? 1 : -1));
  for (const change of orderedChanges) {
    if (new Date(change.at).getTime() < args.since.getTime()) continue;
    const id = keyOf(change.entityType, change.entityId);
    if (changedSeen.has(id)) continue;
    const subject = byKey.get(id);
    if (!subject || subject.audience === "assigned_out") continue;
    changedSeen.add(id);
    changed.push(itemOf(subject, change.reason));
  }

  assigned.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
  const duplicates = [...args.duplicates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const packed = {
    overdue: take(
      overdue.map((row) => row.item),
      args.enabled.overdue,
    ),
    at_risk: take(
      atRisk.map((row) => row.item),
      args.enabled.at_risk,
    ),
    stale: take(
      stale.map((row) => row.item),
      args.enabled.stale,
    ),
    blocked: take(
      blocked.map((row) => row.item),
      args.enabled.blocked,
    ),
    changed: take(changed, args.enabled.changed),
    suggestions: take(args.suggestions.map(noticeItem), args.enabled.suggestions),
    duplicates: take(duplicates.map(noticeItem), args.enabled.duplicates),
    assigned_out: take(
      assigned.map((row) => row.item),
      args.enabled.assigned_out,
    ),
  };

  const sections = emptyDigestSections();
  const counts = emptyDigestCounts();
  for (const key of DIGEST_SECTIONS) {
    sections[key] = packed[key].items;
    counts[key] = packed[key].count;
  }
  return { sections, counts };
}
