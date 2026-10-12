import { createHash } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import type { MutationResult } from "../../lib/mutationResult.js";
import { writeAiAudit, type AiAuditInput } from "./aiAudit.js";
import { deleteManualLink } from "../entityLinks.js";
import { removeDependency } from "../taskDependencies.js";

type Db = NodePgDatabase<typeof schema>;

export const DEFAULT_UNDO_WINDOW_DAYS = 7;

export type UndoInverse =
  | { kind: "remove_tagging"; taggingId: number }
  | { kind: "remove_link"; linkId: number }
  | { kind: "delete_comment"; activityId: number; bodyHash: string }
  | { kind: "remove_dependency"; taskId: number; dependsOnTaskId: number };

export type JournalDraft = {
  action: "tag" | "link" | "comment";
  entityType: string | null;
  entityId: number | null;
  summary: string;
  inverse: UndoInverse;
};

export type UndoRowStatus = "applied" | "undone" | "skipped";

export type UndoTargetState =
  | { kind: "remove_tagging"; present: boolean }
  | { kind: "remove_link"; present: boolean }
  | { kind: "remove_dependency"; present: boolean }
  | { kind: "delete_comment"; present: false }
  | { kind: "delete_comment"; present: true; bodyHash: string; expectedHash: string };

export type UndoDecision =
  | { action: "undo" }
  | { action: "skip" }
  | {
      action: "reject";
      status: 409;
      code: string;
      message: string;
      change?: string;
      canForce?: boolean;
    };

export function commentBodyHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function isWithinUndoWindow(appliedAt: Date, now: Date, days: number): boolean {
  const windowMs = days * 24 * 60 * 60 * 1000;
  return now.getTime() - appliedAt.getTime() <= windowMs;
}

export function shouldAutoApplyTier1(
  planTier: number,
  settings: { tier1Enabled: boolean; tier1OptIn: boolean },
): boolean {
  return planTier === 1 && settings.tier1Enabled && settings.tier1OptIn;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

function positiveId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** A journal row only for a change this apply newly created. */
export function journalDraftFromMutation(args: {
  policyAction?: "link" | "tag" | "comment";
  path: string;
  entityType?: string | null;
  entityId?: number | null;
  summary: string;
  result: MutationResult;
}): JournalDraft | null {
  if (!args.result.ok || args.result.status !== 201) return null;
  const data = asRecord(args.result.data);
  if (!data) return null;
  const summary = args.summary.trim().slice(0, 500) || "AI change";
  const entityType = args.entityType ?? null;
  const entityId = args.entityId ?? null;

  if (args.policyAction === "tag") {
    const taggingId = positiveId(data.taggingId);
    if (taggingId == null) return null;
    return {
      action: "tag",
      entityType,
      entityId,
      summary,
      inverse: { kind: "remove_tagging", taggingId },
    };
  }

  if (args.policyAction === "comment") {
    const activityId = positiveId(data.id);
    const body = typeof data.body === "string" ? data.body : null;
    if (activityId == null || body == null) return null;
    return {
      action: "comment",
      entityType,
      entityId,
      summary,
      inverse: { kind: "delete_comment", activityId, bodyHash: commentBodyHash(body) },
    };
  }

  if (args.policyAction === "link" && args.path === "/api/v1/links") {
    const linkId = positiveId(data.id);
    if (linkId == null) return null;
    return {
      action: "link",
      entityType,
      entityId,
      summary,
      inverse: { kind: "remove_link", linkId },
    };
  }

  if (args.policyAction === "link" && args.path.includes("/dependencies")) {
    if (data.created !== true) return null;
    const taskId = entityId;
    const dependsOnTaskId = positiveId(data.dependsOnTaskId);
    if (taskId == null || dependsOnTaskId == null) return null;
    return {
      action: "link",
      entityType: "task",
      entityId: taskId,
      summary,
      inverse: { kind: "remove_dependency", taskId, dependsOnTaskId },
    };
  }

  return null;
}

export function decideUndo(args: {
  status: UndoRowStatus;
  withinWindow: boolean;
  force: boolean;
  skip: boolean;
  target: UndoTargetState;
}): UndoDecision {
  if (!args.withinWindow) {
    return {
      action: "reject",
      status: 409,
      code: "undo_expired",
      message: "This change is outside the undo window",
    };
  }
  if (args.status !== "applied") {
    return {
      action: "reject",
      status: 409,
      code: "already_resolved",
      message: args.status === "undone" ? "This change was already undone" : "This change was skipped",
    };
  }
  if (args.skip) return { action: "skip" };

  const conflict = conflictFor(args.target);
  if (conflict) {
    if (args.force && conflict.canForce) return { action: "undo" };
    if (args.force && !conflict.canForce) {
      return {
        action: "reject",
        status: 409,
        code: "undo_target_missing",
        message: "This change is already gone. Skip it.",
        change: conflict.change,
        canForce: false,
      };
    }
    return {
      action: "reject",
      status: 409,
      code: "undo_conflict",
      message: conflict.change,
      change: conflict.change,
      canForce: conflict.canForce,
    };
  }
  return { action: "undo" };
}

function conflictFor(target: UndoTargetState): { change: string; canForce: boolean } | null {
  if (target.kind === "remove_tagging" && !target.present) {
    return { change: "The tag is no longer on this record.", canForce: false };
  }
  if (target.kind === "remove_link" && !target.present) {
    return { change: "The link is no longer there.", canForce: false };
  }
  if (target.kind === "remove_dependency" && !target.present) {
    return { change: "The dependency is no longer there.", canForce: false };
  }
  if (target.kind === "delete_comment" && !target.present) {
    return { change: "The comment was deleted.", canForce: false };
  }
  if (
    target.kind === "delete_comment" &&
    target.present &&
    target.bodyHash !== target.expectedHash
  ) {
    return { change: "The comment text changed.", canForce: true };
  }
  return null;
}

export function parseUndoInverse(value: unknown): UndoInverse | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (rec.kind === "remove_tagging") {
    const taggingId = positiveId(rec.taggingId);
    return taggingId == null ? null : { kind: "remove_tagging", taggingId };
  }
  if (rec.kind === "remove_link") {
    const linkId = positiveId(rec.linkId);
    return linkId == null ? null : { kind: "remove_link", linkId };
  }
  if (rec.kind === "delete_comment") {
    const activityId = positiveId(rec.activityId);
    if (activityId == null || typeof rec.bodyHash !== "string" || rec.bodyHash.length === 0) return null;
    return { kind: "delete_comment", activityId, bodyHash: rec.bodyHash };
  }
  if (rec.kind === "remove_dependency") {
    const taskId = positiveId(rec.taskId);
    const dependsOnTaskId = positiveId(rec.dependsOnTaskId);
    if (taskId == null || dependsOnTaskId == null) return null;
    return { kind: "remove_dependency", taskId, dependsOnTaskId };
  }
  return null;
}

export type UndoPort = {
  targetState(inverse: UndoInverse): Promise<UndoTargetState>;
  perform(inverse: UndoInverse): Promise<void>;
};

export async function runUndo(args: {
  status: UndoRowStatus;
  appliedAt: Date;
  now: Date;
  windowDays: number;
  force: boolean;
  skip: boolean;
  inverse: UndoInverse;
  port: UndoPort;
}): Promise<UndoDecision> {
  const target = await args.port.targetState(args.inverse);
  const decision = decideUndo({
    status: args.status,
    withinWindow: isWithinUndoWindow(args.appliedAt, args.now, args.windowDays),
    force: args.force,
    skip: args.skip,
    target,
  });
  if (decision.action === "undo") await args.port.perform(args.inverse);
  return decision;
}

export async function insertUndoJournal(
  db: Db,
  row: JournalDraft & { userId: number; auditId: number | null },
): Promise<{ id: number; summary: string }> {
  const [inserted] = await db
    .insert(schema.aiUndoJournal)
    .values({
      userId: row.userId,
      auditId: row.auditId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      summary: row.summary,
      inverse: row.inverse,
      status: "applied",
    })
    .returning({ id: schema.aiUndoJournal.id, summary: schema.aiUndoJournal.summary });
  if (!inserted) throw new Error("Could not store undo journal row");
  return inserted;
}

export type AiActivityItem = {
  id: number;
  action: string;
  summary: string;
  entityType: string | null;
  entityId: number | null;
  appliedAt: string;
  undoneAt: string | null;
  status: UndoRowStatus;
};

export async function listAiActivity(
  db: Db,
  userId: number,
  now: Date,
  windowDays: number,
): Promise<AiActivityItem[]> {
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(schema.aiUndoJournal)
    .where(and(eq(schema.aiUndoJournal.userId, userId), gte(schema.aiUndoJournal.appliedAt, since)))
    .orderBy(desc(schema.aiUndoJournal.appliedAt), desc(schema.aiUndoJournal.id));
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    summary: row.summary,
    entityType: row.entityType,
    entityId: row.entityId,
    appliedAt: row.appliedAt.toISOString(),
    undoneAt: row.undoneAt?.toISOString() ?? null,
    status: row.status as UndoRowStatus,
  }));
}

async function targetState(db: Db, inverse: UndoInverse): Promise<UndoTargetState> {
  if (inverse.kind === "remove_tagging") {
    const [row] = await db
      .select({ id: schema.taggings.id })
      .from(schema.taggings)
      .where(eq(schema.taggings.id, inverse.taggingId));
    return { kind: "remove_tagging", present: Boolean(row) };
  }
  if (inverse.kind === "remove_link") {
    const [row] = await db
      .select({ id: schema.entityLinks.id })
      .from(schema.entityLinks)
      .where(eq(schema.entityLinks.id, inverse.linkId));
    return { kind: "remove_link", present: Boolean(row) };
  }
  if (inverse.kind === "remove_dependency") {
    const [row] = await db
      .select({ taskId: schema.taskDependencies.taskId })
      .from(schema.taskDependencies)
      .where(
        and(
          eq(schema.taskDependencies.taskId, inverse.taskId),
          eq(schema.taskDependencies.dependsOnTaskId, inverse.dependsOnTaskId),
        ),
      );
    return { kind: "remove_dependency", present: Boolean(row) };
  }
  const [row] = await db
    .select({ body: schema.taskActivity.body, kind: schema.taskActivity.kind })
    .from(schema.taskActivity)
    .where(eq(schema.taskActivity.id, inverse.activityId));
  if (!row || row.kind !== "comment" || row.body == null) {
    return { kind: "delete_comment", present: false };
  }
  return {
    kind: "delete_comment",
    present: true,
    bodyHash: commentBodyHash(row.body),
    expectedHash: inverse.bodyHash,
  };
}

async function performInverse(db: Db, inverse: UndoInverse, actorId: number): Promise<void> {
  if (inverse.kind === "remove_tagging") {
    await db.delete(schema.taggings).where(eq(schema.taggings.id, inverse.taggingId));
    return;
  }
  if (inverse.kind === "remove_link") {
    await deleteManualLink(db, inverse.linkId);
    return;
  }
  if (inverse.kind === "remove_dependency") {
    await removeDependency(db, inverse.taskId, inverse.dependsOnTaskId, {
      actorId,
      source: "ai",
    });
    return;
  }
  await db
    .delete(schema.taskActivity)
    .where(and(eq(schema.taskActivity.id, inverse.activityId), eq(schema.taskActivity.kind, "comment")));
}

export type UndoJournalOutcome =
  | { ok: true; status: "undone" | "skipped" }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      change?: string;
      canForce?: boolean;
    };

export function undoAuditInput(args: {
  userId: number;
  entityType: string | null;
  entityId: number | null;
}): AiAuditInput {
  return {
    userId: args.userId,
    feature: "assistant",
    action: "undo",
    entityType: args.entityType,
    entityId: args.entityId,
    decision: "allow",
    reason: "Undid an automatic AI change",
    tier: 1,
  };
}

export async function undoJournalEntry(
  db: Db,
  args: {
    id: number;
    userId: number;
    force: boolean;
    skip: boolean;
    now: Date;
    windowDays: number;
  },
): Promise<UndoJournalOutcome> {
  const [row] = await db
    .select()
    .from(schema.aiUndoJournal)
    .where(and(eq(schema.aiUndoJournal.id, args.id), eq(schema.aiUndoJournal.userId, args.userId)));
  if (!row) return { ok: false, status: 404, code: "not_found", message: "Activity not found" };
  const inverse = parseUndoInverse(row.inverse);
  if (!inverse) {
    return { ok: false, status: 500, code: "invalid_journal", message: "Undo details are unreadable" };
  }
  const decision = await runUndo({
    status: row.status as UndoRowStatus,
    appliedAt: row.appliedAt,
    now: args.now,
    windowDays: args.windowDays,
    force: args.force,
    skip: args.skip,
    inverse,
    port: {
      targetState: (value) => targetState(db, value),
      perform: (value) => performInverse(db, value, args.userId),
    },
  });
  if (decision.action === "reject") {
    return {
      ok: false,
      status: decision.status,
      code: decision.code,
      message: decision.message,
      ...(decision.change !== undefined ? { change: decision.change } : {}),
      ...(decision.canForce !== undefined ? { canForce: decision.canForce } : {}),
    };
  }
  const nextStatus = decision.action === "undo" ? "undone" : "skipped";
  await db
    .update(schema.aiUndoJournal)
    .set({ status: nextStatus, undoneAt: args.now })
    .where(eq(schema.aiUndoJournal.id, row.id));
  if (decision.action === "undo") {
    await writeAiAudit(
      undoAuditInput({
        userId: args.userId,
        entityType: row.entityType,
        entityId: row.entityId,
      }),
    );
  }
  return { ok: true, status: nextStatus };
}
