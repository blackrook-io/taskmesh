import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { ilikeEscaped } from "../../lib/ilike.js";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { AI_READ_ENTITY_TYPES } from "./aiPolicy.js";
import {
  minimizeComment,
  minimizeGraphNode,
  minimizeLink,
  minimizeTodo,
  minimizeTodoList,
} from "./aiMinimize.js";
import type { EntityType } from "../../lib/entityType.js";
import { DEFAULT_GRAPH_RELATIONS, parseGraphRelations } from "../../lib/graphWalk.js";
import { dueDateSchema, selectableTaskStateSchema, taskPrioritySchema } from "../../lib/taskFields.js";
import { optionalMarkdown, optionalPlainTitle, plainTitle } from "../../lib/markdownFields.js";
import { LINK_RELATIONS } from "../../lib/entityLinkRules.js";
import { isTaggableEntityType } from "../entities.js";
import { listEntityLinks } from "../entityLinks.js";
import { getGraphNeighbourhood } from "../graph.js";
import {
  assertCanAccessDualScoped,
  assertCanAccessEntity,
  assertCanAccessProject,
  dualScopeListFilter,
  OwnershipAccessError,
} from "../ownership.js";
import { userHasAdministrator } from "../roles.js";
import { listDependsOn, listRequiredBy } from "../taskDependencies.js";
import { todosVisibleToAi } from "./projectAiAccess.js";
import type { AssistantProposal, ToolHandlers } from "./tools.js";

const readEntityType = z.enum(AI_READ_ENTITY_TYPES);
const commentEntityType = z.enum(["task", "todo", "todo_list"]);
const linkRelation = z.enum(LINK_RELATIONS);

function proposalId(): string {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function requireActor(handlers: ToolHandlers): { actorUserId: number; isAdministrator: boolean } {
  if (handlers.actorUserId == null) {
    throw new Error("Assistant tool missing actor context");
  }
  return {
    actorUserId: handlers.actorUserId,
    isAdministrator: Boolean(handlers.isAdministrator),
  };
}

function accessDenied(): string {
  return JSON.stringify({ error: "Access denied" });
}

function caughtAccess(err: unknown): string | null {
  if (err instanceof OwnershipAccessError) return accessDenied();
  return null;
}

async function tagNames(entityType: EntityType, entityId: number): Promise<string[]> {
  const rows = await db
    .select({ name: schema.tags.name })
    .from(schema.taggings)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.taggings.tagId))
    .where(and(eq(schema.taggings.entityType, entityType), eq(schema.taggings.entityId, entityId)))
    .orderBy(asc(schema.tags.name));
  return rows.map((row) => row.name);
}

function emit(
  handlers: ToolHandlers,
  proposal: AssistantProposal,
): string {
  handlers.onProposal?.(proposal);
  return JSON.stringify({
    ok: true,
    proposalId: proposal.id,
    message: "Proposal sent to the user for confirmation. Do not claim it was saved.",
  });
}

export async function toolListTodos(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      projectId: z.number().int().positive().optional(),
      listId: z.number().int().positive().optional(),
      q: z.string().min(1).max(200).optional(),
    })
    .parse(args);
  const { actorUserId, isAdministrator } = requireActor(handlers);
  try {
    if (parsed.projectId != null) {
      await assertCanAccessProject(db, actorUserId, parsed.projectId);
    }
    if (parsed.listId != null) {
      const [list] = await db
        .select()
        .from(schema.todoLists)
        .where(eq(schema.todoLists.id, parsed.listId));
      if (!list) return JSON.stringify({ error: "List not found" });
      await assertCanAccessDualScoped(db, actorUserId, list);
    }
    const scope = dualScopeListFilter(
      db,
      schema.todos.projectId,
      schema.todos.ownerId,
      actorUserId,
      isAdministrator,
    );
    const visible = await todosVisibleToAi(db);
    const filters = [
      ne(schema.todos.state, "deleted"),
      scope ?? sql`true`,
      visible,
      parsed.projectId != null ? eq(schema.todos.projectId, parsed.projectId) : undefined,
    ];
    const rows = parsed.listId != null
      ? await db
          .select({
            id: schema.todos.id,
            projectId: schema.todos.projectId,
            title: schema.todos.title,
            number: schema.todos.number,
            state: schema.todos.state,
            priority: schema.todos.priority,
            progress: schema.todos.progress,
            dueDate: schema.todos.dueDate,
          })
          .from(schema.todos)
          .innerJoin(
            schema.todoListItems,
            and(
              eq(schema.todoListItems.entityId, schema.todos.id),
              eq(schema.todoListItems.entityType, "todo"),
              eq(schema.todoListItems.listId, parsed.listId),
            ),
          )
          .where(and(...filters.filter((part) => part != null)))
          .orderBy(asc(schema.todoListItems.sortOrder))
          .limit(40)
      : await db
          .select({
            id: schema.todos.id,
            projectId: schema.todos.projectId,
            title: schema.todos.title,
            number: schema.todos.number,
            state: schema.todos.state,
            priority: schema.todos.priority,
            progress: schema.todos.progress,
            dueDate: schema.todos.dueDate,
          })
          .from(schema.todos)
          .where(
            and(
              ...filters.filter((part) => part != null),
              parsed.q ? ilikeEscaped(schema.todos.title, parsed.q) : sql`true`,
            ),
          )
          .orderBy(desc(schema.todos.updatedAt))
          .limit(20);
    return JSON.stringify({
      todos: rows.map((row) => ({
        id: row.id,
        number: row.number,
        title: row.title,
        projectId: row.projectId,
        state: row.state,
        priority: row.priority,
        progress: row.progress,
        dueDate: row.dueDate,
      })),
    });
  } catch (err) {
    const denied = caughtAccess(err);
    if (denied) return denied;
    throw err;
  }
}

export async function toolGetTodo(entityId: number, actorUserId: number): Promise<string> {
  const [row] = await db.select().from(schema.todos).where(eq(schema.todos.id, entityId));
  if (!row || row.state === "deleted") return JSON.stringify({ error: "ToDo not found" });
  await assertCanAccessDualScoped(db, actorUserId, row);
  return JSON.stringify(minimizeTodo({ ...row, tags: await tagNames("todo", row.id) }));
}

export async function toolGetTodoList(entityId: number, actorUserId: number): Promise<string> {
  const [row] = await db.select().from(schema.todoLists).where(eq(schema.todoLists.id, entityId));
  if (!row) return JSON.stringify({ error: "List not found" });
  await assertCanAccessDualScoped(db, actorUserId, row);
  return JSON.stringify(minimizeTodoList(row));
}

export async function toolListLinks(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z.object({ entityType: readEntityType, entityId: z.number().int().positive() }).parse(args);
  const { actorUserId, isAdministrator } = requireActor(handlers);
  try {
    await assertCanAccessEntity(db, actorUserId, parsed.entityType, parsed.entityId);
    const data = await listEntityLinks(db, parsed.entityType, parsed.entityId, {
      userId: actorUserId,
      isAdministrator,
    });
    const links = [
      ...data.outgoing.map((row) =>
        minimizeLink({
          id: row.id,
          relation: row.relation,
          origin: row.origin,
          direction: "outgoing",
          entityType: row.entity.entityType,
          entityId: row.entity.id,
          title: row.entity.title,
          referenceId: row.entity.referenceId,
        }),
      ),
      ...data.incoming.map((row) =>
        minimizeLink({
          id: row.id,
          relation: row.relation,
          origin: row.origin,
          direction: "incoming",
          entityType: row.entity.entityType,
          entityId: row.entity.id,
          title: row.entity.title,
          referenceId: row.entity.referenceId,
        }),
      ),
    ];
    return JSON.stringify({ links });
  } catch (err) {
    const denied = caughtAccess(err);
    if (denied) return denied;
    throw err;
  }
}

export async function toolListTags(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z.object({ entityType: readEntityType, entityId: z.number().int().positive() }).parse(args);
  const { actorUserId } = requireActor(handlers);
  if (!isTaggableEntityType(parsed.entityType)) {
    return JSON.stringify({ error: "This record type does not support tags" });
  }
  try {
    await assertCanAccessEntity(db, actorUserId, parsed.entityType, parsed.entityId);
    return JSON.stringify({ tags: await tagNames(parsed.entityType, parsed.entityId) });
  } catch (err) {
    const denied = caughtAccess(err);
    if (denied) return denied;
    throw err;
  }
}

export async function toolListComments(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({ entityType: commentEntityType, entityId: z.number().int().positive() })
    .parse(args);
  const { actorUserId } = requireActor(handlers);
  try {
    await assertCanAccessEntity(db, actorUserId, parsed.entityType, parsed.entityId);
    const rows = await db
      .select({
        id: schema.taskActivity.id,
        body: schema.taskActivity.body,
        createdAt: schema.taskActivity.createdAt,
      })
      .from(schema.taskActivity)
      .where(
        and(
          eq(schema.taskActivity.entityType, parsed.entityType),
          eq(schema.taskActivity.entityId, parsed.entityId),
          eq(schema.taskActivity.kind, "comment"),
        ),
      )
      .orderBy(desc(schema.taskActivity.createdAt), desc(schema.taskActivity.id))
      .limit(20);
    return JSON.stringify({ comments: rows.map((row) => minimizeComment(row)) });
  } catch (err) {
    const denied = caughtAccess(err);
    if (denied) return denied;
    throw err;
  }
}

export async function toolListTaskDependencies(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z.object({ taskId: z.number().int().positive() }).parse(args);
  const { actorUserId } = requireActor(handlers);
  try {
    await assertCanAccessEntity(db, actorUserId, "task", parsed.taskId);
    const [dependsOn, requiredBy] = await Promise.all([
      listDependsOn(db, parsed.taskId),
      listRequiredBy(db, parsed.taskId),
    ]);
    const brief = (row: { id: number; number: number; title: string; state: string }) => ({
      id: row.id,
      number: row.number,
      title: row.title,
      state: row.state,
    });
    return JSON.stringify({
      dependsOn: dependsOn.map(brief),
      requiredBy: requiredBy.map(brief),
    });
  } catch (err) {
    const denied = caughtAccess(err);
    if (denied) return denied;
    throw err;
  }
}

export async function toolGetNeighbourhood(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      entityType: readEntityType,
      entityId: z.number().int().positive(),
      depth: z.number().int().min(1).max(3).optional(),
      rel: z.string().max(400).optional(),
      hideDone: z.boolean().optional(),
    })
    .parse(args);
  const { actorUserId, isAdministrator } = requireActor(handlers);
  const relations = parseGraphRelations(parsed.rel);
  if (!relations.ok) return JSON.stringify({ error: `Unknown relation: ${relations.unknown}` });
  try {
    await assertCanAccessEntity(db, actorUserId, parsed.entityType, parsed.entityId);
    const data = await getGraphNeighbourhood(
      db,
      { userId: actorUserId, isAdministrator },
      {
        rootType: parsed.entityType,
        rootId: parsed.entityId,
        depth: parsed.depth ?? 2,
        relations: relations.relations,
        hideDone: parsed.hideDone === true,
      },
    );
    return JSON.stringify({
      nodes: data.nodes.map((node) =>
        minimizeGraphNode({
          key: node.key,
          type: node.type,
          id: node.id,
          title: node.title,
          state: node.state,
        }),
      ),
      edges: data.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        relation: edge.relation,
      })),
      truncated: data.truncated,
      relations: parsed.rel?.trim() ? [...relations.relations] : [...DEFAULT_GRAPH_RELATIONS],
    });
  } catch (err) {
    const denied = caughtAccess(err);
    if (denied) return denied;
    throw err;
  }
}

export async function toolProposeTodoCreate(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      title: plainTitle(2000),
      description: optionalMarkdown(50_000),
      dueDate: dueDateSchema,
      state: selectableTaskStateSchema.optional(),
      priority: taskPrioritySchema.optional(),
      progress: z.number().int().min(0).max(100).optional(),
      projectId: z.number().int().positive().optional(),
      summary: z.string().min(1).max(500),
    })
    .parse(args);
  const { actorUserId } = requireActor(handlers);
  try {
    if (parsed.projectId != null) {
      await assertCanAccessProject(db, actorUserId, parsed.projectId, "write");
    }
  } catch (err) {
    const denied = caughtAccess(err);
    if (denied) return denied;
    throw err;
  }
  const fields: Record<string, unknown> = { title: parsed.title };
  if (parsed.description !== undefined) fields.description = parsed.description;
  if (parsed.dueDate !== undefined) fields.dueDate = parsed.dueDate;
  if (parsed.state !== undefined) fields.state = parsed.state;
  if (parsed.priority !== undefined) fields.priority = parsed.priority;
  if (parsed.progress !== undefined) fields.progress = parsed.progress;
  if (parsed.projectId !== undefined) fields.projectId = parsed.projectId;
  return emit(handlers, {
    id: proposalId(),
    action: "create",
    entityType: "todo",
    projectId: parsed.projectId,
    summary: parsed.summary,
    fields,
    method: "POST",
    path: "/api/v1/todos",
  });
}

export async function toolProposeTodoUpdate(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      todoId: z.number().int().positive(),
      title: optionalPlainTitle(2000),
      description: optionalMarkdown(50_000),
      dueDate: dueDateSchema,
      state: selectableTaskStateSchema.optional(),
      priority: taskPrioritySchema.optional(),
      progress: z.number().int().min(0).max(100).optional(),
      summary: z.string().min(1).max(500),
    })
    .parse(args);
  const { actorUserId } = requireActor(handlers);
  const [existing] = await db.select().from(schema.todos).where(eq(schema.todos.id, parsed.todoId));
  if (!existing || existing.state === "deleted") return JSON.stringify({ error: "ToDo not found" });
  try {
    await assertCanAccessDualScoped(db, actorUserId, existing, "write");
  } catch (err) {
    const denied = caughtAccess(err);
    if (denied) return denied;
    throw err;
  }
  const fields: Record<string, unknown> = {};
  if (parsed.title !== undefined) fields.title = parsed.title;
  if (parsed.description !== undefined) fields.description = parsed.description;
  if (parsed.dueDate !== undefined) fields.dueDate = parsed.dueDate;
  if (parsed.state !== undefined) fields.state = parsed.state;
  if (parsed.priority !== undefined) fields.priority = parsed.priority;
  if (parsed.progress !== undefined) fields.progress = parsed.progress;
  if (Object.keys(fields).length === 0) {
    return JSON.stringify({ error: "Provide at least one field to update" });
  }
  return emit(handlers, {
    id: proposalId(),
    action: "update",
    entityType: "todo",
    entityId: parsed.todoId,
    projectId: existing.projectId ?? undefined,
    summary: parsed.summary,
    fields,
    method: "PATCH",
    path: `/api/v1/todos/${parsed.todoId}`,
  });
}

export async function toolProposeTodoListCreate(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      title: plainTitle(500),
      projectId: z.number().int().positive().optional(),
      summary: z.string().min(1).max(500),
    })
    .parse(args);
  const { actorUserId } = requireActor(handlers);
  try {
    if (parsed.projectId != null) {
      await assertCanAccessProject(db, actorUserId, parsed.projectId, "write");
    }
  } catch (err) {
    const denied = caughtAccess(err);
    if (denied) return denied;
    throw err;
  }
  return emit(handlers, {
    id: proposalId(),
    action: "create",
    entityType: "todo_list",
    projectId: parsed.projectId,
    summary: parsed.summary,
    fields: {
      title: parsed.title,
      ...(parsed.projectId !== undefined ? { projectId: parsed.projectId } : {}),
    },
    method: "POST",
    path: "/api/v1/todo-lists",
  });
}

export async function toolProposeTodoListUpdate(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      listId: z.number().int().positive(),
      title: plainTitle(500),
      summary: z.string().min(1).max(500),
    })
    .parse(args);
  const { actorUserId } = requireActor(handlers);
  const [existing] = await db
    .select()
    .from(schema.todoLists)
    .where(eq(schema.todoLists.id, parsed.listId));
  if (!existing) return JSON.stringify({ error: "List not found" });
  try {
    await assertCanAccessDualScoped(db, actorUserId, existing, "write");
  } catch (err) {
    const denied = caughtAccess(err);
    if (denied) return denied;
    throw err;
  }
  return emit(handlers, {
    id: proposalId(),
    action: "update",
    entityType: "todo_list",
    entityId: parsed.listId,
    projectId: existing.projectId ?? undefined,
    summary: parsed.summary,
    fields: { title: parsed.title },
    method: "PATCH",
    path: `/api/v1/todo-lists/${parsed.listId}`,
  });
}

export async function toolProposeLink(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      srcType: readEntityType,
      srcId: z.number().int().positive(),
      dstType: readEntityType,
      dstId: z.number().int().positive(),
      relation: linkRelation.optional(),
      summary: z.string().min(1).max(500),
    })
    .parse(args);
  const { actorUserId } = requireActor(handlers);
  try {
    await assertCanAccessEntity(db, actorUserId, parsed.srcType, parsed.srcId, "write");
    await assertCanAccessEntity(db, actorUserId, parsed.dstType, parsed.dstId);
  } catch (err) {
    const denied = caughtAccess(err);
    if (denied) return denied;
    throw err;
  }
  return emit(handlers, {
    id: proposalId(),
    action: "create",
    policyAction: "link",
    entityType: parsed.srcType,
    entityId: parsed.srcId,
    summary: parsed.summary,
    fields: {
      srcType: parsed.srcType,
      srcId: parsed.srcId,
      dstType: parsed.dstType,
      dstId: parsed.dstId,
      ...(parsed.relation !== undefined ? { relation: parsed.relation } : {}),
    },
    method: "POST",
    path: "/api/v1/links",
  });
}

export async function toolProposeTag(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      entityType: readEntityType,
      entityId: z.number().int().positive(),
      name: plainTitle(100),
      summary: z.string().min(1).max(500),
    })
    .parse(args);
  if (!isTaggableEntityType(parsed.entityType)) {
    return JSON.stringify({ error: "This record type does not support tags" });
  }
  const { actorUserId } = requireActor(handlers);
  try {
    await assertCanAccessEntity(db, actorUserId, parsed.entityType, parsed.entityId, "write");
  } catch (err) {
    const denied = caughtAccess(err);
    if (denied) return denied;
    throw err;
  }
  return emit(handlers, {
    id: proposalId(),
    action: "create",
    policyAction: "tag",
    entityType: parsed.entityType,
    entityId: parsed.entityId,
    summary: parsed.summary,
    fields: { name: parsed.name, entityType: parsed.entityType, entityId: parsed.entityId },
    method: "POST",
    path: "/api/v1/taggings",
  });
}

export async function toolProposeComment(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      entityType: commentEntityType,
      entityId: z.number().int().positive(),
      body: z.string().min(1).max(50_000),
      summary: z.string().min(1).max(500),
    })
    .parse(args);
  const { actorUserId } = requireActor(handlers);
  try {
    await assertCanAccessEntity(db, actorUserId, parsed.entityType, parsed.entityId, "write");
  } catch (err) {
    const denied = caughtAccess(err);
    if (denied) return denied;
    throw err;
  }
  const path =
    parsed.entityType === "task"
      ? `/api/v1/tasks/${parsed.entityId}/activity`
      : parsed.entityType === "todo"
        ? `/api/v1/todos/${parsed.entityId}/activity`
        : `/api/v1/todo-lists/${parsed.entityId}/activity`;
  return emit(handlers, {
    id: proposalId(),
    action: "create",
    policyAction: "comment",
    entityType: parsed.entityType,
    entityId: parsed.entityId,
    summary: parsed.summary,
    fields: { body: parsed.body },
    method: "POST",
    path,
  });
}

export async function toolProposeTaskDependency(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      taskId: z.number().int().positive(),
      dependsOnTaskId: z.number().int().positive(),
      projectId: z.number().int().positive().optional(),
      summary: z.string().min(1).max(500),
    })
    .parse(args);
  const { actorUserId } = requireActor(handlers);
  try {
    await assertCanAccessEntity(db, actorUserId, "task", parsed.taskId, "write");
    await assertCanAccessEntity(db, actorUserId, "task", parsed.dependsOnTaskId, "write");
  } catch (err) {
    const denied = caughtAccess(err);
    if (denied) return denied;
    throw err;
  }
  return emit(handlers, {
    id: proposalId(),
    action: "create",
    policyAction: "link",
    entityType: "task",
    entityId: parsed.taskId,
    projectId: parsed.projectId,
    summary: parsed.summary,
    fields: { dependsOnTaskId: parsed.dependsOnTaskId },
    method: "POST",
    path: `/api/v1/tasks/${parsed.taskId}/dependencies`,
  });
}
