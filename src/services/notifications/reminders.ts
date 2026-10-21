import { and, eq, gte, inArray, isNotNull, isNull, lte, notInArray, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import { formatEntityRef } from "../../lib/entityRef.js";
import { shiftIsoDate, zonedParts } from "../../lib/notificationSchedule.js";
import { hrefFor } from "../references.js";
import { deliverNotification } from "./deliver.js";
import { preferenceFor } from "./preferences.js";
import { renderReminderNotification } from "./templates.js";

type Db = NodePgDatabase<typeof schema>;

const CLOSED = ["complete", "canceled", "deleted"] as const;

type Candidate = {
  entityType: "task" | "todo";
  id: number;
  number: number;
  title: string;
  dueDate: string | null;
  actionBy: Date | null;
  assigneeId: number | null;
  ownerId: number;
  projectId: number | null;
};

function recipientId(row: Candidate): number {
  return row.assigneeId ?? row.ownerId;
}

async function alreadySent(
  db: Db,
  input: { userId: number; entityType: "task" | "todo"; entityId: number; kind: "due" | "action_by"; marker: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.notificationReminderMarks.id })
    .from(schema.notificationReminderMarks)
    .where(
      and(
        eq(schema.notificationReminderMarks.userId, input.userId),
        eq(schema.notificationReminderMarks.entityType, input.entityType),
        eq(schema.notificationReminderMarks.entityId, input.entityId),
        eq(schema.notificationReminderMarks.kind, input.kind),
        eq(schema.notificationReminderMarks.marker, input.marker),
      ),
    )
    .limit(1);
  return row != null;
}

async function markSent(
  db: Db,
  input: { userId: number; entityType: "task" | "todo"; entityId: number; kind: "due" | "action_by"; marker: string },
): Promise<void> {
  await db
    .insert(schema.notificationReminderMarks)
    .values(input)
    .onConflictDoNothing({
      target: [
        schema.notificationReminderMarks.userId,
        schema.notificationReminderMarks.entityType,
        schema.notificationReminderMarks.entityId,
        schema.notificationReminderMarks.kind,
        schema.notificationReminderMarks.marker,
      ],
    });
}

async function remind(db: Db, row: Candidate, kind: "due" | "action_by", whenLabel: string, marker: string): Promise<boolean> {
  const userId = recipientId(row);
  if (await alreadySent(db, { userId, entityType: row.entityType, entityId: row.id, kind, marker })) return false;
  const entityLabel = formatEntityRef(row.entityType, row.number);
  const rendered = renderReminderNotification({
    entityLabel,
    title: row.title,
    kind,
    whenLabel,
  });
  const delivery = await deliverNotification(db, {
    userId,
    type: "reminder",
    title: rendered.title,
    body: rendered.body,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    href: hrefFor(row.entityType, row.id, row.projectId),
  });
  if (delivery.inApp || delivery.email !== "skipped") {
    await markSent(db, { userId, entityType: row.entityType, entityId: row.id, kind, marker });
  }
  return delivery.inApp || delivery.email !== "skipped";
}

/**
 * Due-date reminders for open Tasks and ToDos, and action-by reminders for open ToDos.
 * A reminder fires once, on the recipient's local calendar day for that date.
 */
export async function scanDueReminders(db: Db, now = new Date()): Promise<number> {
  const utcDay = now.toISOString().slice(0, 10);
  const dueFrom = shiftIsoDate(utcDay, -1);
  const dueTo = shiftIsoDate(utcDay, 1);
  const actionFrom = new Date(now.getTime() - 48 * 60 * 60_000);
  const actionTo = new Date(now.getTime() + 48 * 60 * 60_000);

  const taskRows = await db
    .select({
      id: schema.tasks.id,
      number: schema.tasks.number,
      title: schema.tasks.title,
      dueDate: schema.tasks.dueDate,
      assigneeId: schema.tasks.assigneeId,
      ownerId: schema.tasks.ownerId,
      projectId: schema.tasks.projectId,
    })
    .from(schema.tasks)
    .where(
      and(
        notInArray(schema.tasks.state, [...CLOSED]),
        isNotNull(schema.tasks.dueDate),
        gte(schema.tasks.dueDate, dueFrom),
        lte(schema.tasks.dueDate, dueTo),
      ),
    );
  const todoRows = await db
    .select({
      id: schema.todos.id,
      number: schema.todos.number,
      title: schema.todos.title,
      dueDate: schema.todos.dueDate,
      actionBy: schema.todos.actionBy,
      assigneeId: schema.todos.assigneeId,
      ownerId: schema.todos.ownerId,
      projectId: schema.todos.projectId,
    })
    .from(schema.todos)
    .where(
      and(
        notInArray(schema.todos.state, [...CLOSED]),
        or(
          and(
            isNotNull(schema.todos.dueDate),
            gte(schema.todos.dueDate, dueFrom),
            lte(schema.todos.dueDate, dueTo),
          ),
          and(
            isNotNull(schema.todos.actionBy),
            gte(schema.todos.actionBy, actionFrom),
            lte(schema.todos.actionBy, actionTo),
          ),
        ),
      ),
    );

  const candidates: Candidate[] = [
    ...taskRows.map((row) => ({ ...row, entityType: "task" as const, actionBy: null })),
    ...todoRows.map((row) => ({ ...row, entityType: "todo" as const })),
  ];
  const userIds = [...new Set(candidates.map(recipientId))];
  if (userIds.length === 0) return 0;
  const activeRows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        inArray(schema.users.id, userIds),
        isNull(schema.users.deactivatedAt),
        isNull(schema.users.lockedAt),
      ),
    );
  const active = new Set(activeRows.map((row) => row.id));
  let sent = 0;
  for (const row of candidates) {
    const userId = recipientId(row);
    if (!active.has(userId)) continue;
    const prefs = await preferenceFor(db, userId, "reminder");
    const today = zonedParts(now, prefs.timeZone).date;
    if (row.dueDate === today) {
      if (await remind(db, row, "due", today, row.dueDate)) sent += 1;
    }
    if (row.actionBy) {
      const actionDay = zonedParts(row.actionBy, prefs.timeZone).date;
      if (actionDay === today) {
        if (await remind(db, row, "action_by", actionDay, row.actionBy.toISOString())) sent += 1;
      }
    }
  }
  return sent;
}
