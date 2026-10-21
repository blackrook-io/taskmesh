import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import type { EntityType } from "../../lib/entityType.js";
import { formatEntityRef } from "../../lib/entityRef.js";
import { hrefFor } from "../references.js";
import { deliverNotification } from "./deliver.js";
import { renderAssignmentNotification, renderMentionNotification } from "./templates.js";

type Db = NodePgDatabase<typeof schema>;

type WorkRef = {
  entityType: "task" | "todo";
  id: number;
  number: number;
  title: string;
  ownerId: number;
  assigneeId: number | null;
  projectId: number | null;
};

async function actorName(db: Db, userId: number): Promise<string> {
  const [row] = await db
    .select({ displayName: schema.users.displayName })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return row?.displayName?.trim() || "Someone";
}

async function workRef(db: Db, entityType: "task" | "todo", id: number): Promise<WorkRef | null> {
  if (entityType === "task") {
    const [row] = await db
      .select({
        id: schema.tasks.id,
        number: schema.tasks.number,
        title: schema.tasks.title,
        ownerId: schema.tasks.ownerId,
        assigneeId: schema.tasks.assigneeId,
        projectId: schema.tasks.projectId,
      })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, id));
    return row ? { ...row, entityType } : null;
  }
  const [row] = await db
    .select({
      id: schema.todos.id,
      number: schema.todos.number,
      title: schema.todos.title,
      ownerId: schema.todos.ownerId,
      assigneeId: schema.todos.assigneeId,
      projectId: schema.todos.projectId,
    })
    .from(schema.todos)
    .where(eq(schema.todos.id, id));
  return row ? { ...row, entityType } : null;
}

async function sourceLabel(db: Db, entityType: EntityType, id: number): Promise<string> {
  if (entityType === "task" || entityType === "todo") {
    const row = await workRef(db, entityType, id);
    return row ? `${formatEntityRef(entityType, row.number)} ${row.title}` : "another record";
  }
  if (entityType === "idea") {
    const [row] = await db
      .select({ number: schema.ideas.number, title: schema.ideas.title })
      .from(schema.ideas)
      .where(eq(schema.ideas.id, id));
    return row ? `${formatEntityRef("idea", row.number)} ${row.title}` : "another record";
  }
  if (entityType === "project") {
    const [row] = await db
      .select({ number: schema.projects.number, name: schema.projects.name })
      .from(schema.projects)
      .where(eq(schema.projects.id, id));
    return row ? `${formatEntityRef("project", row.number)} ${row.name}` : "another record";
  }
  if (entityType === "document") {
    const [row] = await db
      .select({ number: schema.projectDocuments.number, title: schema.projectDocuments.title })
      .from(schema.projectDocuments)
      .where(eq(schema.projectDocuments.id, id));
    return row ? `${formatEntityRef("document", row.number)} ${row.title}` : "another record";
  }
  return "another record";
}

export async function notifyAssigneeChange(
  db: Db,
  input: {
    actorUserId: number;
    previousAssigneeId: number | null;
    assigneeId: number | null;
    entityType: "task" | "todo";
    entityId: number;
    number: number;
    title: string;
    projectId: number | null;
  },
): Promise<void> {
  if (input.assigneeId == null) return;
  if (input.assigneeId === input.previousAssigneeId) return;
  if (input.assigneeId === input.actorUserId) return;
  const actor = await actorName(db, input.actorUserId);
  const entityLabel = formatEntityRef(input.entityType, input.number);
  const rendered = renderAssignmentNotification({
    entityLabel,
    title: input.title,
    actorName: actor,
  });
  await deliverNotification(db, {
    userId: input.assigneeId,
    type: "assignment",
    title: rendered.title,
    body: rendered.body,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    href: hrefFor(input.entityType, input.entityId, input.projectId),
  });
}

export function reportAssigneeChange(
  db: Db,
  input: Parameters<typeof notifyAssigneeChange>[1],
): void {
  void notifyAssigneeChange(db, input).catch((err) => {
    console.error("[notifications] assignment", err);
  });
}

export async function notifyMentions(
  db: Db,
  input: {
    actorUserId: number;
    srcType: EntityType;
    srcId: number;
    targets: Array<{ entityType: EntityType; id: number }>;
  },
): Promise<void> {
  const workTargets = input.targets.filter(
    (target): target is { entityType: "task" | "todo"; id: number } =>
      target.entityType === "task" || target.entityType === "todo",
  );
  if (workTargets.length === 0) return;
  const actor = await actorName(db, input.actorUserId);
  const from = await sourceLabel(db, input.srcType, input.srcId);
  for (const target of workTargets) {
    const row = await workRef(db, target.entityType, target.id);
    if (!row) continue;
    const userId = row.assigneeId ?? row.ownerId;
    if (userId === input.actorUserId) continue;
    const entityLabel = formatEntityRef(row.entityType, row.number);
    const rendered = renderMentionNotification({
      entityLabel,
      title: row.title,
      sourceLabel: from,
      actorName: actor,
    });
    await deliverNotification(db, {
      userId,
      type: "mention",
      title: rendered.title,
      body: rendered.body,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      href: hrefFor(row.entityType, row.id, row.projectId),
    });
  }
}

export function reportMentions(db: Db, input: Parameters<typeof notifyMentions>[1]): void {
  void notifyMentions(db, input).catch((err) => {
    console.error("[notifications] mention", err);
  });
}
