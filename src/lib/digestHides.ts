import {
  DIGEST_SECTIONS,
  emptyDigestCounts,
  emptyDigestSections,
  type DigestCounts,
  type DigestItem,
  type DigestPrefs,
  type DigestSection,
  type DigestSections,
} from "./digest.js";
import { addIsoDays, wallClock, zonedInstant } from "./digestSignals.js";

export type DigestHide = {
  entityType: string;
  entityId: number;
  section: DigestSection;
  kind: "snooze" | "dismiss";
  periodKey: string | null;
  until: string | null;
};

export function hideKey(entityType: string, entityId: number, section: string): string {
  return `${section}\0${entityType}\0${entityId}`;
}

/** Dismiss matches this period only. Snooze matches until the stored instant. */
export function hideApplies(hide: DigestHide, periodKey: string, now: Date): boolean {
  if (hide.kind === "dismiss") return hide.periodKey === periodKey;
  if (!hide.until) return false;
  const until = new Date(hide.until).getTime();
  return Number.isFinite(until) && until > now.getTime();
}

/** Tomorrow or seven days on, at local midnight in the digest timezone. */
export function snoozeUntil(span: "tomorrow" | "week", now: Date, timeZone: string): Date {
  const today = wallClock(now, timeZone).iso;
  const days = span === "week" ? 7 : 1;
  return zonedInstant(addIsoDays(today, days), 0, timeZone);
}

export function applyDigestHides(args: {
  sections: DigestSections;
  hides: readonly DigestHide[];
  periodKey: string;
  now: Date;
}): { sections: DigestSections; hidden: DigestCounts } {
  const active = new Set<string>();
  for (const hide of args.hides) {
    if (hideApplies(hide, args.periodKey, args.now)) {
      active.add(hideKey(hide.entityType, hide.entityId, hide.section));
    }
  }
  const sections = emptyDigestSections();
  const hidden = emptyDigestCounts();
  for (const section of DIGEST_SECTIONS) {
    const kept: DigestItem[] = [];
    for (const item of args.sections[section]) {
      if (active.has(hideKey(item.entityType, item.entityId, section))) hidden[section] += 1;
      else kept.push(item);
    }
    sections[section] = kept;
  }
  return { sections, hidden };
}

export type DigestPrefsPatch = {
  frequency?: DigestPrefs["frequency"];
  summary?: boolean;
  sections?: Partial<Record<string, boolean>>;
  timeZone?: string;
};

function validZone(value: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Merge a prefs edit onto the stored defaults. Hour is left unchanged. */
export function applyDigestPrefsPatch(
  current: DigestPrefs,
  patch: DigestPrefsPatch,
): { ok: true; prefs: DigestPrefs } | { ok: false; message: string } {
  const next: DigestPrefs = {
    ...current,
    sections: { ...current.sections },
  };
  if (patch.frequency !== undefined) {
    if (patch.frequency !== "daily" && patch.frequency !== "weekly") {
      return { ok: false, message: "Frequency must be daily or weekly" };
    }
    next.frequency = patch.frequency;
  }
  if (patch.summary !== undefined) {
    if (typeof patch.summary !== "boolean") return { ok: false, message: "Summary must be on or off" };
    next.summary = patch.summary;
  }
  if (patch.timeZone !== undefined) {
    if (!validZone(patch.timeZone)) return { ok: false, message: "Timezone is not recognized" };
    next.timeZone = patch.timeZone;
  }
  if (patch.sections !== undefined) {
    for (const [key, value] of Object.entries(patch.sections)) {
      if (!(DIGEST_SECTIONS as readonly string[]).includes(key)) {
        return { ok: false, message: "Unknown digest section" };
      }
      if (typeof value !== "boolean") return { ok: false, message: "Section flags must be true or false" };
      next.sections[key as DigestSection] = value;
    }
  }
  return { ok: true, prefs: next };
}
