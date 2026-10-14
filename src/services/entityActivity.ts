import { and, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import type { ActivitySource } from "../lib/activityRequest.js";
import {
  ACTIVITY_UPDATE_FIELDS,
  commentExcerpt,
  commentPairsWithUpdate,
  deriveListLastUpdate,
  documentBodyChanged,
  trackedAiAccessChange,
  trackedAiLocalOnlyChange,
  trackedStatusChange,
  trackedTodoChanges,
  type ActivityUpdateField,
  type LastActivity,
  type LastComment,
  type LastUpdate,
} from "../lib/entityActivity.js";
import { isEntityType, type EntityType } from "../lib/entityType.js";

type Db = NodePgDatabase<typeof schema>;

export type ActivityRef = { type: EntityType; id: number };

type ChangeRow = {
  field: ActivityUpdateField | "state" | "progress" | "estimateHours" | "startDate" | "status" | "body";
  oldValue: string | null;
  newValue: string | null;
};

type UpdateHit = LastUpdate & { actorId: number | null };
type CommentHit = { at: string; atDate: Date; actorId: number | null; excerpt: string };

function publicUpdate(update: LastUpdate | null): LastUpdate | null {
  if (!update) return null;
  return {
    at: update.at,
    field: update.field,
    oldValue: update.oldValue,
    newValue: update.newValue,
  };
}

function refKey(type: string, id: number): string {
  return `${type}:${id}`;
}

export async function recordTrackedChanges(
  db: Db,
  args: {
    entityType: EntityType;
    entityId: number;
    actorId?: number | null;
    source?: ActivitySource;
    changes: readonly ChangeRow[];
  },
): Promise<void> {
  if (args.changes.length === 0) return;
  await db.insert(schema.taskActivity).values(
    args.changes.map((change) => ({
      taskId: args.entityType === "task" ? args.entityId : null,
      entityType: args.entityType,
      entityId: args.entityId,
      kind: "change" as const,
      field: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue,
      createdById: args.actorId ?? null,
      source: args.source ?? "api",
    })),
  );
}

export async function recordTodoFieldChanges(
  db: Db,
  todoId: number,
  before: { state: string; progress: number; estimateHours?: number | null; startDate?: string | null },
  after: { state: string; progress: number; estimateHours?: number | null; startDate?: string | null },
  actorId: number | null,
  source: ActivitySource = "api",
): Promise<void> {
  await recordTrackedChanges(db, {
    entityType: "todo",
    entityId: todoId,
    actorId,
    source,
    changes: trackedTodoChanges(before, after),
  });
}

export async function recordProjectStatusChange(
  db: Db,
  projectId: number,
  before: string,
  after: string,
  actorId: number | null,
  source: ActivitySource = "api",
): Promise<void> {
  const change = trackedStatusChange(before, after);
  if (!change) return;
  await recordTrackedChanges(db, {
    entityType: "project",
    entityId: projectId,
    actorId,
    source,
    changes: [change],
  });
}

export async function recordProjectAiLocalOnlyChange(
  db: Db,
  projectId: number,
  before: boolean,
  after: boolean,
  actorId: number | null,
  source: ActivitySource = "api",
): Promise<void> {
  const change = trackedAiLocalOnlyChange(before, after);
  if (!change) return;
  await recordTrackedChanges(db, {
    entityType: "project",
    entityId: projectId,
    actorId,
    source,
    changes: [change],
  });
}

export async function recordProjectAiAccessChange(
  db: Db,
  projectId: number,
  before: string,
  after: string,
  actorId: number | null,
  source: ActivitySource = "api",
): Promise<void> {
  const change = trackedAiAccessChange(before, after);
  if (!change) return;
  await recordTrackedChanges(db, {
    entityType: "project",
    entityId: projectId,
    actorId,
    source,
    changes: [change],
  });
}

export async function recordDocumentBodyChange(
  db: Db,
  documentId: number,
  before: string | null,
  after: string | null,
  actorId: number | null,
  source: ActivitySource = "api",
): Promise<void> {
  if (!documentBodyChanged(before, after)) return;
  await recordTrackedChanges(db, {
    entityType: "document",
    entityId: documentId,
    actorId,
    source,
    changes: [{ field: "body", oldValue: null, newValue: null }],
  });
}

type ActivitySqlRow = {
  entity_type: string;
  entity_id: number;
  created_at: Date | string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  body: string | null;
  created_by_id: number | null;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

async function latestRows(
  db: Db,
  refs: ActivityRef[],
  kind: "change" | "comment",
): Promise<ActivitySqlRow[]> {
  if (refs.length === 0) return [];
  const tuples = sql.join(
    refs.map((ref) => sql`(${ref.type}, ${ref.id})`),
    sql`, `,
  );
  const fieldClause =
    kind === "change"
      ? sql`AND field IN (${sql.join(
          ACTIVITY_UPDATE_FIELDS.map((field) => sql`${field}`),
          sql`, `,
        )})`
      : sql``;
  const result = await db.execute(sql`
    SELECT DISTINCT ON (entity_type, entity_id)
      entity_type, entity_id, created_at, field, old_value, new_value, body, created_by_id
    FROM task_activity
    WHERE kind = ${kind}
      AND (entity_type, entity_id) IN (${tuples})
      ${fieldClause}
    ORDER BY entity_type, entity_id, created_at DESC, id DESC
  `);
  return result.rows as ActivitySqlRow[];
}

function toUpdate(row: ActivitySqlRow): UpdateHit {
  const atDate = asDate(row.created_at);
  return {
    at: atDate.toISOString(),
    field: row.field ?? "",
    oldValue: row.old_value,
    newValue: row.new_value,
    actorId: row.created_by_id,
  };
}

/**
 * Latest state/progress/status/body change and latest comment for each ref.
 * ToDo List updates are the newest change among member ToDos and Tasks.
 * A list's own comments are its last comment, paired with that derived update.
 */
export async function getLastActivity(
  db: Db,
  refs: readonly ActivityRef[],
): Promise<Map<string, LastActivity>> {
  const direct: ActivityRef[] = [];
  const listIds: number[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!isEntityType(ref.type) || !Number.isInteger(ref.id) || ref.id <= 0) continue;
    const key = refKey(ref.type, ref.id);
    if (seen.has(key)) continue;
    seen.add(key);
    if (ref.type === "todo_list") listIds.push(ref.id);
    else direct.push(ref);
  }
  const commentRefs: ActivityRef[] = [
    ...direct,
    ...listIds.map((id) => ({ type: "todo_list" as const, id })),
  ];

  const membersByList = new Map<number, ActivityRef[]>();
  if (listIds.length > 0) {
    const members = await db
      .select({
        listId: schema.todoListItems.listId,
        entityType: schema.todoListItems.entityType,
        entityId: schema.todoListItems.entityId,
      })
      .from(schema.todoListItems)
      .where(
        and(
          inArray(schema.todoListItems.listId, listIds),
          inArray(schema.todoListItems.entityType, ["todo", "task"]),
        ),
      );
    for (const member of members) {
      if (!isEntityType(member.entityType) || (member.entityType !== "todo" && member.entityType !== "task")) {
        continue;
      }
      const list = membersByList.get(member.listId) ?? [];
      list.push({ type: member.entityType, id: member.entityId });
      membersByList.set(member.listId, list);
      const key = refKey(member.entityType, member.entityId);
      if (!seen.has(key)) {
        seen.add(key);
        direct.push({ type: member.entityType, id: member.entityId });
      }
    }
  }

  const [updateRows, commentRows] = await Promise.all([
    latestRows(db, direct, "change"),
    latestRows(db, commentRefs, "comment"),
  ]);

  const updates = new Map<string, UpdateHit>();
  for (const row of updateRows) updates.set(refKey(row.entity_type, row.entity_id), toUpdate(row));
  const comments = new Map<string, CommentHit>();
  for (const row of commentRows) {
    const atDate = asDate(row.created_at);
    comments.set(refKey(row.entity_type, row.entity_id), {
      at: atDate.toISOString(),
      atDate,
      actorId: row.created_by_id,
      excerpt: commentExcerpt(row.body ?? ""),
    });
  }

  const out = new Map<string, LastActivity>();
  const pack = (type: string, id: number, lastUpdate: UpdateHit | null, includeComment: boolean): LastActivity => {
    const comment = includeComment ? comments.get(refKey(type, id)) : undefined;
    const lastComment: LastComment | null = comment
      ? {
          at: comment.at,
          excerpt: comment.excerpt,
          withUpdate: commentPairsWithUpdate(
            { at: comment.atDate, actorId: comment.actorId },
            lastUpdate ? { at: new Date(lastUpdate.at), actorId: lastUpdate.actorId } : null,
          ),
        }
      : null;
    return {
      lastUpdate: publicUpdate(lastUpdate),
      lastComment,
    };
  };

  for (const ref of refs) {
    if (ref.type === "todo_list") continue;
    if (!seen.has(refKey(ref.type, ref.id))) continue;
    out.set(
      refKey(ref.type, ref.id),
      pack(ref.type, ref.id, updates.get(refKey(ref.type, ref.id)) ?? null, true),
    );
  }

  for (const listId of listIds) {
    const members = membersByList.get(listId) ?? [];
    const derived = deriveListLastUpdate(
      members.map((member) => updates.get(refKey(member.type, member.id)) ?? null),
    );
    out.set(refKey("todo_list", listId), pack("todo_list", listId, derived, true));
  }

  return out;
}
