import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

export const AI_FEEDBACK_KINDS = ["thumb_up", "thumb_down", "accept", "dismiss", "undo"] as const;
export type AiFeedbackKind = (typeof AI_FEEDBACK_KINDS)[number];

const THUMB_KINDS = ["thumb_up", "thumb_down"] as const;

export class AiFeedbackError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type RecordedFeedback = {
  id: number;
  auditId: number;
  kind: AiFeedbackKind;
  note: string | null;
  createdAt: Date;
  /** False when an accept, dismiss, or undo for this audit row already existed. */
  created: boolean;
};

function isThumb(kind: AiFeedbackKind): boolean {
  return kind === "thumb_up" || kind === "thumb_down";
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === "23505";
}

export async function recordAiFeedback(
  db: Db,
  input: {
    auditId: number;
    actorUserId: number;
    isAdministrator: boolean;
    kind: AiFeedbackKind;
    note?: string | null;
  },
): Promise<RecordedFeedback> {
  const [audit] = await db
    .select({ id: schema.aiAuditLog.id, userId: schema.aiAuditLog.userId })
    .from(schema.aiAuditLog)
    .where(eq(schema.aiAuditLog.id, input.auditId));
  if (!audit) {
    throw new AiFeedbackError(404, "not_found", "Audit row not found");
  }
  const owns = audit.userId != null && audit.userId === input.actorUserId;
  if (!owns && !input.isAdministrator) {
    throw new AiFeedbackError(403, "forbidden", "You cannot rate this output");
  }

  let note: string | null = null;
  if (isThumb(input.kind)) {
    const trimmed = input.note?.trim() ?? "";
    if (trimmed.length > 500) {
      throw new AiFeedbackError(400, "invalid_note", "Note must be 500 characters or fewer");
    }
    note = trimmed.length > 0 ? trimmed : null;
  }

  if (isThumb(input.kind)) {
    const [existing] = await db
      .select()
      .from(schema.aiOutputFeedback)
      .where(
        and(
          eq(schema.aiOutputFeedback.auditId, input.auditId),
          eq(schema.aiOutputFeedback.userId, input.actorUserId),
          inArray(schema.aiOutputFeedback.kind, [...THUMB_KINDS]),
        ),
      );
    if (existing) {
      const [updated] = await db
        .update(schema.aiOutputFeedback)
        .set({ kind: input.kind, note, createdAt: new Date() })
        .where(eq(schema.aiOutputFeedback.id, existing.id))
        .returning();
      return toRecorded(updated ?? existing, true);
    }
    try {
      const [inserted] = await db
        .insert(schema.aiOutputFeedback)
        .values({
          auditId: input.auditId,
          userId: input.actorUserId,
          kind: input.kind,
          note,
        })
        .returning();
      if (!inserted) throw new AiFeedbackError(500, "feedback_failed", "Could not store feedback");
      return toRecorded(inserted, true);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const [again] = await db
        .select()
        .from(schema.aiOutputFeedback)
        .where(
          and(
            eq(schema.aiOutputFeedback.auditId, input.auditId),
            eq(schema.aiOutputFeedback.userId, input.actorUserId),
            inArray(schema.aiOutputFeedback.kind, [...THUMB_KINDS]),
          ),
        );
      if (!again) throw err;
      const [updated] = await db
        .update(schema.aiOutputFeedback)
        .set({ kind: input.kind, note, createdAt: new Date() })
        .where(eq(schema.aiOutputFeedback.id, again.id))
        .returning();
      return toRecorded(updated ?? again, true);
    }
  }

  const [existing] = await db
    .select()
    .from(schema.aiOutputFeedback)
    .where(
      and(eq(schema.aiOutputFeedback.auditId, input.auditId), eq(schema.aiOutputFeedback.kind, input.kind)),
    );
  if (existing) return toRecorded(existing, false);

  try {
    const [inserted] = await db
      .insert(schema.aiOutputFeedback)
      .values({
        auditId: input.auditId,
        userId: input.actorUserId,
        kind: input.kind,
        note: null,
      })
      .returning();
    if (!inserted) throw new AiFeedbackError(500, "feedback_failed", "Could not store feedback");
    return toRecorded(inserted, true);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const [again] = await db
      .select()
      .from(schema.aiOutputFeedback)
      .where(
        and(
          eq(schema.aiOutputFeedback.auditId, input.auditId),
          eq(schema.aiOutputFeedback.kind, input.kind),
        ),
      );
    if (!again) throw err;
    return toRecorded(again, false);
  }
}

function toRecorded(
  row: typeof schema.aiOutputFeedback.$inferSelect,
  created: boolean,
): RecordedFeedback {
  return {
    id: row.id,
    auditId: row.auditId,
    kind: row.kind as AiFeedbackKind,
    note: row.note,
    createdAt: row.createdAt,
    created,
  };
}

export type QualityCount = {
  feature: string;
  model: string | null;
  kind: AiFeedbackKind;
  count: number;
};

export type QualityGroup = {
  feature: string;
  model: string | null;
  thumbUp: number;
  thumbDown: number;
  accept: number;
  dismiss: number;
  undo: number;
  /** thumb_up / (thumb_up + thumb_down). Null when neither thumb was given. */
  thumbUpRate: number | null;
  /** accept / (accept + dismiss). Null when neither outcome was recorded. */
  acceptRate: number | null;
  /** undo / accept. Null when nothing was accepted. */
  undoRate: number | null;
};

export function summarizeQuality(counts: QualityCount[]): QualityGroup[] {
  const map = new Map<string, QualityGroup>();
  for (const row of counts) {
    const key = `${row.feature}\0${row.model ?? ""}`;
    let group = map.get(key);
    if (!group) {
      group = {
        feature: row.feature,
        model: row.model,
        thumbUp: 0,
        thumbDown: 0,
        accept: 0,
        dismiss: 0,
        undo: 0,
        thumbUpRate: null,
        acceptRate: null,
        undoRate: null,
      };
      map.set(key, group);
    }
    if (row.kind === "thumb_up") group.thumbUp += row.count;
    else if (row.kind === "thumb_down") group.thumbDown += row.count;
    else if (row.kind === "accept") group.accept += row.count;
    else if (row.kind === "dismiss") group.dismiss += row.count;
    else if (row.kind === "undo") group.undo += row.count;
  }
  for (const group of map.values()) {
    const thumbs = group.thumbUp + group.thumbDown;
    group.thumbUpRate = thumbs === 0 ? null : group.thumbUp / thumbs;
    const outcomes = group.accept + group.dismiss;
    group.acceptRate = outcomes === 0 ? null : group.accept / outcomes;
    group.undoRate = group.accept === 0 ? null : group.undo / group.accept;
  }
  return [...map.values()].sort((a, b) => {
    const feature = a.feature.localeCompare(b.feature);
    if (feature !== 0) return feature;
    return (a.model ?? "").localeCompare(b.model ?? "");
  });
}

export type QualityNote = {
  feature: string;
  model: string | null;
  kind: "thumb_up" | "thumb_down";
  note: string;
  createdAt: string;
};

export async function getAiQualitySummary(
  db: Db,
  days: number,
): Promise<{ days: number; groups: QualityGroup[]; notes: QualityNote[] }> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const counted = await db
    .select({
      feature: schema.aiAuditLog.feature,
      model: schema.aiAuditLog.model,
      kind: schema.aiOutputFeedback.kind,
      n: count(),
    })
    .from(schema.aiOutputFeedback)
    .innerJoin(schema.aiAuditLog, eq(schema.aiOutputFeedback.auditId, schema.aiAuditLog.id))
    .where(gte(schema.aiOutputFeedback.createdAt, since))
    .groupBy(schema.aiAuditLog.feature, schema.aiAuditLog.model, schema.aiOutputFeedback.kind);

  const notes = await db
    .select({
      feature: schema.aiAuditLog.feature,
      model: schema.aiAuditLog.model,
      kind: schema.aiOutputFeedback.kind,
      note: schema.aiOutputFeedback.note,
      createdAt: schema.aiOutputFeedback.createdAt,
    })
    .from(schema.aiOutputFeedback)
    .innerJoin(schema.aiAuditLog, eq(schema.aiOutputFeedback.auditId, schema.aiAuditLog.id))
    .where(
      and(
        gte(schema.aiOutputFeedback.createdAt, since),
        inArray(schema.aiOutputFeedback.kind, [...THUMB_KINDS]),
      ),
    )
    .orderBy(desc(schema.aiOutputFeedback.createdAt))
    .limit(40);

  return {
    days,
    groups: summarizeQuality(
      counted.map((row) => ({
        feature: row.feature,
        model: row.model,
        kind: row.kind as AiFeedbackKind,
        count: Number(row.n),
      })),
    ),
    notes: notes
      .filter((row): row is typeof row & { note: string } => Boolean(row.note?.trim()))
      .slice(0, 20)
      .map((row) => ({
        feature: row.feature,
        model: row.model,
        kind: row.kind as "thumb_up" | "thumb_down",
        note: row.note.trim(),
        createdAt: row.createdAt.toISOString(),
      })),
  };
}

