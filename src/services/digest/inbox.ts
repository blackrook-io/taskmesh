import { and, eq } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import {
  applyDigestHides,
  applyDigestPrefsPatch,
  snoozeUntil,
  type DigestHide,
  type DigestPrefsPatch,
} from "../../lib/digestHides.js";
import { isDigestSection, parseDigestPrefs, type DigestPrefs, type DigestSection } from "../../lib/digest.js";
import { isEntityType } from "../../lib/entityType.js";
import { listDigests, type Db, type DigestView } from "./service.js";

export type DigestInbox = {
  digest: DigestView | null;
  hidden: Record<DigestSection, number>;
  unread: boolean;
  prefs: DigestPrefs;
};

function toHide(row: typeof schema.digestItemHides.$inferSelect): DigestHide | null {
  if (!isDigestSection(row.section)) return null;
  if (row.kind !== "snooze" && row.kind !== "dismiss") return null;
  return {
    entityType: row.entityType,
    entityId: row.entityId,
    section: row.section,
    kind: row.kind,
    periodKey: row.periodKey,
    until: row.until ? row.until.toISOString() : null,
  };
}

async function latest(db: Db, userId: number): Promise<DigestView | null> {
  const rows = await listDigests(db, userId, 1);
  return rows[0] ?? null;
}

async function loadUser(db: Db, userId: number) {
  const [user] = await db
    .select({
      digestPrefs: schema.users.digestPrefs,
      digestSeenAt: schema.users.digestSeenAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return user ?? null;
}

export async function getInbox(db: Db, userId: number, now = new Date()): Promise<DigestInbox | null> {
  const user = await loadUser(db, userId);
  if (!user) return null;
  const prefs = parseDigestPrefs(user.digestPrefs);
  const digest = await latest(db, userId);
  if (!digest) {
    return { digest: null, hidden: emptyHidden(), unread: false, prefs };
  }
  const rows = await db
    .select()
    .from(schema.digestItemHides)
    .where(eq(schema.digestItemHides.userId, userId));
  const hides = rows.flatMap((row) => {
    const hide = toHide(row);
    return hide ? [hide] : [];
  });
  const applied = applyDigestHides({
    sections: digest.sections,
    hides,
    periodKey: digest.periodKey,
    now,
  });
  const unread = user.digestSeenAt == null || user.digestSeenAt.getTime() < new Date(digest.generatedAt).getTime();
  return {
    digest: { ...digest, sections: applied.sections },
    hidden: applied.hidden,
    unread,
    prefs,
  };
}

function emptyHidden(): Record<DigestSection, number> {
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

export async function markDigestSeen(db: Db, userId: number): Promise<{ unread: boolean }> {
  const digest = await latest(db, userId);
  if (!digest) return { unread: false };
  await db
    .update(schema.users)
    .set({ digestSeenAt: new Date(digest.generatedAt), updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
  return { unread: false };
}

async function itemInLatest(
  db: Db,
  userId: number,
  entityType: string,
  entityId: number,
  section: DigestSection,
): Promise<DigestView | null> {
  const digest = await latest(db, userId);
  if (!digest) return null;
  const found = digest.sections[section].some((item) => item.entityType === entityType && item.entityId === entityId);
  return found ? digest : null;
}

export async function dismissDigestItem(
  db: Db,
  userId: number,
  args: { entityType: string; entityId: number; section: string },
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (!isEntityType(args.entityType) || !isDigestSection(args.section)) {
    return { ok: false, status: 400, message: "Unknown record or section" };
  }
  const digest = await itemInLatest(db, userId, args.entityType, args.entityId, args.section);
  if (!digest) return { ok: false, status: 404, message: "Digest item not found" };
  await upsertHide(db, {
    userId,
    entityType: args.entityType,
    entityId: args.entityId,
    section: args.section,
    kind: "dismiss",
    periodKey: digest.periodKey,
    until: null,
  });
  return { ok: true };
}

export async function snoozeDigestItem(
  db: Db,
  userId: number,
  args: { entityType: string; entityId: number; section: string; span: "tomorrow" | "week" },
  now = new Date(),
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (!isEntityType(args.entityType) || !isDigestSection(args.section)) {
    return { ok: false, status: 400, message: "Unknown record or section" };
  }
  const digest = await itemInLatest(db, userId, args.entityType, args.entityId, args.section);
  if (!digest) return { ok: false, status: 404, message: "Digest item not found" };
  await upsertHide(db, {
    userId,
    entityType: args.entityType,
    entityId: args.entityId,
    section: args.section,
    kind: "snooze",
    periodKey: null,
    until: snoozeUntil(args.span, now, digest.timeZone),
  });
  return { ok: true };
}

async function upsertHide(
  db: Db,
  values: {
    userId: number;
    entityType: string;
    entityId: number;
    section: string;
    kind: "snooze" | "dismiss";
    periodKey: string | null;
    until: Date | null;
  },
): Promise<void> {
  await db
    .insert(schema.digestItemHides)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.digestItemHides.userId,
        schema.digestItemHides.entityType,
        schema.digestItemHides.entityId,
        schema.digestItemHides.section,
      ],
      set: {
        kind: values.kind,
        periodKey: values.periodKey,
        until: values.until,
        createdAt: new Date(),
      },
    });
}

export async function saveDigestPrefs(
  db: Db,
  userId: number,
  patch: DigestPrefsPatch,
): Promise<{ ok: true; prefs: DigestPrefs } | { ok: false; status: number; message: string }> {
  const user = await loadUser(db, userId);
  if (!user) return { ok: false, status: 404, message: "User not found" };
  const merged = applyDigestPrefsPatch(parseDigestPrefs(user.digestPrefs), patch);
  if (!merged.ok) return { ok: false, status: 400, message: merged.message };
  await db
    .update(schema.users)
    .set({ digestPrefs: merged.prefs, updatedAt: new Date() })
    .where(and(eq(schema.users.id, userId)));
  return { ok: true, prefs: merged.prefs };
}
