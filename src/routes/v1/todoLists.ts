import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { optionalPlainTitle, plainTitle } from "../../lib/markdownFields.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { hasDefinedKeys } from "../../lib/immutableFields.js";
import { allocateTodoListNumber, allocateTodoNumber } from "../../services/entityNumbers.js";
import {
  assertCanAccessProject,
  assertCanAccessViaProject,
  dualScopeListFilter,
} from "../../services/ownership.js";
import { userHasAdministrator } from "../../services/roles.js";
import { allocateTaskNumber } from "../../services/tasks.js";
import { ensureInboxList } from "../../services/todoLists.js";
import { getCurrentUserId } from "../../services/users.js";
import { copyTaggings } from "../../services/copyTaggings.js";

const listBody = z.object({
  title: plainTitle(500),
  projectId: z.number().int().positive().optional().nullable(),
});

const listPatch = z.object({
  title: optionalPlainTitle(500),
});

/** New memberships: todo | task. Legacy idea rows remain readable. */
const itemEntity = z.enum(["todo", "task"]);

const itemBody = z.object({
  entityType: itemEntity,
  entityId: z.number().int().positive(),
  checked: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const itemPatch = z.object({
  checked: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const reorderBody = z.object({
  orderedItemIds: z.array(z.number().int().positive()).min(1),
});

const createItemBody = z.object({
  entityType: itemEntity,
  title: plainTitle(2000),
  projectId: z.number().int().positive().optional(),
});

const convertBody = z.object({
  projectId: z.number().int().positive(),
  title: optionalPlainTitle(2000),
});

const convertToTodoBody = z.object({
  projectId: z.number().int().positive().optional().nullable(),
  title: optionalPlainTitle(2000),
});

const idParam = z.coerce.number().int().positive();

export const todoListsRouter = Router();

async function loadList(listId: number) {
  const [list] = await db.select().from(schema.todoLists).where(eq(schema.todoLists.id, listId));
  return list ?? null;
}

/**
 * Unsorted inbox: unassigned tasks + ToDos not on any named list.
 * Ideas live on the Ideas UI — not shown here.
 */
async function hydrateUnsortedItems(inboxListId: number) {
  const namedLists = await db
    .select({ id: schema.todoLists.id })
    .from(schema.todoLists)
    .where(eq(schema.todoLists.kind, "list"));
  const namedIds = namedLists.map((l) => l.id);

  const listed =
    namedIds.length === 0
      ? []
      : await db
          .select({
            entityType: schema.todoListItems.entityType,
            entityId: schema.todoListItems.entityId,
          })
          .from(schema.todoListItems)
          .where(inArray(schema.todoListItems.listId, namedIds));

  const listedTodos = new Set(
    listed.filter((r) => r.entityType === "todo").map((r) => r.entityId),
  );
  const listedTasks = new Set(
    listed.filter((r) => r.entityType === "task").map((r) => r.entityId),
  );

  const todos = await db
    .select()
    .from(schema.todos)
    .where(and(isNull(schema.todos.projectId), ne(schema.todos.state, "deleted")))
    .orderBy(asc(schema.todos.id));
  const tasks = await db
    .select()
    .from(schema.tasks)
    .where(and(isNull(schema.tasks.projectId), ne(schema.tasks.state, "deleted")))
    .orderBy(asc(schema.tasks.id));

  const out = [];
  let sort = 0;
  for (const todo of todos) {
    if (listedTodos.has(todo.id)) continue;
    out.push({
      id: -(sort + 1),
      listId: inboxListId,
      entityType: "todo" as const,
      entityId: todo.id,
      sortOrder: sort++,
      checked: false,
      createdAt: todo.createdAt,
      updatedAt: todo.updatedAt,
      title: todo.title,
      href: null as string | null,
      virtual: true,
      state: todo.state,
      dueDate: todo.dueDate,
      priority: todo.priority,
      actionBy: todo.actionBy?.toISOString() ?? null,
    });
  }
  for (const task of tasks) {
    if (listedTasks.has(task.id)) continue;
    out.push({
      id: -(sort + 1),
      listId: inboxListId,
      entityType: "task" as const,
      entityId: task.id,
      sortOrder: sort++,
      checked: false,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      title: task.title,
      href: null as string | null,
      virtual: true,
      state: task.state,
      dueDate: task.dueDate,
      priority: task.priority,
    });
  }
  return out;
}

async function hydrateItems(listId: number) {
  const list = await loadList(listId);
  if (list?.kind === "inbox") {
    return hydrateUnsortedItems(listId);
  }

  const rows = await db
    .select()
    .from(schema.todoListItems)
    .where(eq(schema.todoListItems.listId, listId))
    .orderBy(asc(schema.todoListItems.sortOrder), asc(schema.todoListItems.id));

  const out = [];
  for (const row of rows) {
    let title = `${row.entityType} #${row.entityId}`;
    let href: string | null = null;
    let state: string | undefined;
    let dueDate: string | null | undefined;
    let priority: string | undefined;
    let actionBy: string | null | undefined;
    if (row.entityType === "idea") {
      const [idea] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, row.entityId));
      if (idea) {
        title = idea.title;
        href = `/ideas/${idea.id}`;
      }
    } else if (row.entityType === "todo") {
      const [todo] = await db.select().from(schema.todos).where(eq(schema.todos.id, row.entityId));
      if (todo && todo.state !== "deleted") {
        title = todo.title;
        href = null;
        state = todo.state;
        dueDate = todo.dueDate;
        priority = todo.priority;
        actionBy = todo.actionBy?.toISOString() ?? null;
      } else if (todo?.state === "deleted") {
        title = `${todo.title} (deleted)`;
        state = todo.state;
      }
    } else if (row.entityType === "task") {
      const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, row.entityId));
      if (task) {
        title = task.title;
        href = task.projectId != null ? `/projects/${task.projectId}?tab=tasks` : null;
        state = task.state;
        dueDate = task.dueDate;
        priority = task.priority;
      }
    }
    out.push({ ...row, title, href, state, dueDate, priority, actionBy });
  }
  return out;
}

todoListsRouter.get("/", async (req, res) => {
  try {
    await ensureInboxList(db);
    const actorId = await getCurrentUserId(db);
    const isAdmin = await userHasAdministrator(db, actorId);
    const projectIdRaw = req.query.projectId;
    let rows;
    if (projectIdRaw === "null" || projectIdRaw === "") {
      rows = await db
        .select()
        .from(schema.todoLists)
        .where(isNull(schema.todoLists.projectId))
        .orderBy(asc(schema.todoLists.id));
    } else if (projectIdRaw != null) {
      const projectId = idParam.parse(projectIdRaw);
      await assertCanAccessProject(db, actorId, projectId);
      rows = await db
        .select()
        .from(schema.todoLists)
        .where(eq(schema.todoLists.projectId, projectId))
        .orderBy(asc(schema.todoLists.id));
    } else {
      const scope = dualScopeListFilter(db, schema.todoLists.projectId, actorId, isAdmin);
      rows = await db
        .select()
        .from(schema.todoLists)
        .where(scope)
        .orderBy(asc(schema.todoLists.id));
    }
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

todoListsRouter.post("/", async (req, res) => {
  try {
    const parsed = listBody.parse(req.body);
    const ownerId = await getCurrentUserId(db);
    if (parsed.projectId != null) {
      await assertCanAccessProject(db, ownerId, parsed.projectId);
    }
    const number = await allocateTodoListNumber(db);
    const [row] = await db
      .insert(schema.todoLists)
      .values({
        number,
        title: parsed.title,
        projectId: parsed.projectId ?? null,
        kind: "list",
        ownerId,
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create list");
      return;
    }
    res.status(201).json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

todoListsRouter.get("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const list = await loadList(id);
    if (!list) {
      sendError(res, 404, "not_found", "List not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessViaProject(db, actorId, list.projectId);
    const items = await hydrateItems(id);
    res.json({ data: { ...list, items } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

todoListsRouter.patch("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const parsed = listPatch.parse(req.body);
    if (!hasDefinedKeys(parsed, ["title"])) {
      sendError(res, 400, "empty_patch", "Provide title");
      return;
    }
    const list = await loadList(id);
    if (!list) {
      sendError(res, 404, "not_found", "List not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessViaProject(db, actorId, list.projectId);
    if (list.kind === "inbox" && parsed.title !== undefined && parsed.title !== list.title) {
      // allow rename of inbox
    }
    const [row] = await db
      .update(schema.todoLists)
      .set({
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.todoLists.id, id))
      .returning();
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

todoListsRouter.delete("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const list = await loadList(id);
    if (!list) {
      sendError(res, 404, "not_found", "List not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessViaProject(db, actorId, list.projectId);
    if (list.kind === "inbox") {
      sendError(res, 400, "protected_list", "Cannot delete the Unsorted list");
      return;
    }
    await db.delete(schema.todoLists).where(eq(schema.todoLists.id, id));
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});

todoListsRouter.get("/:id/items", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const list = await loadList(id);
    if (!list) {
      sendError(res, 404, "not_found", "List not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessViaProject(db, actorId, list.projectId);
    res.json({ data: await hydrateItems(id) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

todoListsRouter.post("/:id/items", async (req, res) => {
  try {
    const listId = idParam.parse(req.params.id);
    const list = await loadList(listId);
    if (!list) {
      sendError(res, 404, "not_found", "List not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessViaProject(db, actorId, list.projectId);
    if (list.kind === "inbox") {
      sendError(
        res,
        400,
        "virtual_list",
        "Unsorted is computed automatically — add items to a named list, or create unassigned tasks/ideas",
      );
      return;
    }
    const parsed = itemBody.parse(req.body);
    if (parsed.entityType === "todo") {
      const [todo] = await db.select().from(schema.todos).where(eq(schema.todos.id, parsed.entityId));
      if (!todo || todo.state === "deleted") {
        sendError(res, 404, "not_found", "ToDo not found");
        return;
      }
    } else {
      const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, parsed.entityId));
      if (!task || task.state === "deleted") {
        sendError(res, 404, "not_found", "Task not found");
        return;
      }
    }
    const existing = await db
      .select({ m: schema.todoListItems.sortOrder })
      .from(schema.todoListItems)
      .where(eq(schema.todoListItems.listId, listId));
    const nextSort =
      parsed.sortOrder ?? (existing.length ? Math.max(...existing.map((r) => r.m)) + 1 : 0);
    try {
      const [row] = await db
        .insert(schema.todoListItems)
        .values({
          listId,
          entityType: parsed.entityType,
          entityId: parsed.entityId,
          checked: parsed.checked ?? false,
          sortOrder: nextSort,
        })
        .returning();
      if (!row) {
        sendError(res, 500, "insert_failed", "Could not add item");
        return;
      }
      const match = (await hydrateItems(listId)).find((i) => i.id === row.id);
      res.status(201).json({ data: match ?? row });
    } catch (insertErr) {
      const pg = insertErr as { code?: string };
      if (pg.code === "23505") {
        sendError(res, 409, "already_on_list", "That item is already on this list");
        return;
      }
      throw insertErr;
    }
  } catch (err) {
    handleRouteError(res, err);
  }
});

/** Create a new ToDo or task and append it to this list. */
todoListsRouter.post("/:id/items/create", async (req, res) => {
  try {
    const listId = idParam.parse(req.params.id);
    const list = await loadList(listId);
    if (!list) {
      sendError(res, 404, "not_found", "List not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessViaProject(db, actorId, list.projectId);
    const parsed = createItemBody.parse(req.body);
    const title = parsed.title.trim();
    let entityType = parsed.entityType;
    let entityId: number;

    if (entityType === "todo") {
      const projectId = parsed.projectId ?? list.projectId ?? null;
      if (projectId != null) {
        await assertCanAccessProject(db, actorId, projectId);
      }
      const number = await allocateTodoNumber(db);
      const [todo] = await db
        .insert(schema.todos)
        .values({
          projectId,
          number,
          title,
          sortOrder: 0,
          createdById: actorId,
          updatedById: actorId,
          ownerId: actorId,
        })
        .returning();
      if (!todo) {
        sendError(res, 500, "insert_failed", "Could not create ToDo");
        return;
      }
      entityId = todo.id;
    } else {
      const projectId = parsed.projectId ?? list.projectId ?? null;
      let phaseId: number | null = null;
      if (projectId != null) {
        await assertCanAccessProject(db, actorId, projectId);
      }
      const number = await allocateTaskNumber(db);
      const [task] = await db
        .insert(schema.tasks)
        .values({
          projectId,
          phaseId,
          number,
          title,
          sortOrder: 0,
          createdById: actorId,
          updatedById: actorId,
          ownerId: actorId,
        })
        .returning();
      if (!task) {
        sendError(res, 500, "insert_failed", "Could not create task");
        return;
      }
      entityId = task.id;
    }

    if (list.kind === "inbox") {
      // Unsorted is virtual — entity appears automatically when unlisted / unassigned.
      const match = (await hydrateItems(listId)).find(
        (i) => i.entityType === entityType && i.entityId === entityId,
      );
      res.status(201).json({ data: match ?? { entityType, entityId, title } });
      return;
    }

    const existing = await db
      .select({ m: schema.todoListItems.sortOrder })
      .from(schema.todoListItems)
      .where(eq(schema.todoListItems.listId, listId));
    const nextSort = existing.length ? Math.max(...existing.map((r) => r.m)) + 1 : 0;
    const [row] = await db
      .insert(schema.todoListItems)
      .values({
        listId,
        entityType,
        entityId,
        checked: false,
        sortOrder: nextSort,
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not add item");
      return;
    }
    const match = (await hydrateItems(listId)).find((i) => i.id === row.id);
    res.status(201).json({ data: match ?? row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

todoListsRouter.patch("/:id/items/reorder", async (req, res) => {
  try {
    const listId = idParam.parse(req.params.id);
    const list = await loadList(listId);
    if (!list) {
      sendError(res, 404, "not_found", "List not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessViaProject(db, actorId, list.projectId);
    if (list.kind === "inbox") {
      sendError(res, 400, "virtual_list", "Unsorted order is not persisted");
      return;
    }
    const { orderedItemIds } = reorderBody.parse(req.body);
    const existing = await db
      .select({ id: schema.todoListItems.id })
      .from(schema.todoListItems)
      .where(eq(schema.todoListItems.listId, listId));
    const allowed = new Set(existing.map((e) => e.id));
    if (orderedItemIds.length !== allowed.size) {
      sendError(res, 400, "invalid_reorder", "orderedItemIds must list every item exactly once");
      return;
    }
    for (const iid of orderedItemIds) {
      if (!allowed.has(iid)) {
        sendError(res, 400, "invalid_item", `Item ${iid} is not in this list`);
        return;
      }
    }
    for (let i = 0; i < orderedItemIds.length; i++) {
      const iid = orderedItemIds[i];
      if (iid === undefined) continue;
      await db
        .update(schema.todoListItems)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(schema.todoListItems.id, iid));
    }
    res.json({ data: await hydrateItems(listId) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

todoListsRouter.patch("/:id/items/:itemId", async (req, res) => {
  try {
    const listId = idParam.parse(req.params.id);
    const itemId = idParam.parse(req.params.itemId);
    const parsed = itemPatch.parse(req.body);
    if (!hasDefinedKeys(parsed, ["checked", "sortOrder"])) {
      sendError(res, 400, "empty_patch", "Provide checked and/or sortOrder");
      return;
    }
    const list = await loadList(listId);
    if (!list) {
      sendError(res, 404, "not_found", "List not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessViaProject(db, actorId, list.projectId);
    const [existing] = await db
      .select()
      .from(schema.todoListItems)
      .where(eq(schema.todoListItems.id, itemId));
    if (!existing || existing.listId !== listId) {
      sendError(res, 404, "not_found", "Item not found");
      return;
    }
    const [row] = await db
      .update(schema.todoListItems)
      .set({
        ...(parsed.checked !== undefined ? { checked: parsed.checked } : {}),
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.todoListItems.id, itemId))
      .returning();
    const match = (await hydrateItems(listId)).find((i) => i.id === itemId);
    res.json({ data: match ?? row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

todoListsRouter.delete("/:id/items/:itemId", async (req, res) => {
  try {
    const listId = idParam.parse(req.params.id);
    const itemId = idParam.parse(req.params.itemId);
    const list = await loadList(listId);
    if (!list) {
      sendError(res, 404, "not_found", "List not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessViaProject(db, actorId, list.projectId);
    const deleted = await db
      .delete(schema.todoListItems)
      .where(
        and(eq(schema.todoListItems.id, itemId), eq(schema.todoListItems.listId, listId)),
      )
      .returning({ id: schema.todoListItems.id });
    if (deleted.length === 0) {
      sendError(res, 404, "not_found", "Item not found");
      return;
    }
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});

/**
 * Convert a list item to a Task and rewrite the membership row.
 * Supports legacy idea items and ToDo items.
 */
todoListsRouter.post("/:id/items/:itemId/convert-to-task", async (req, res) => {
  try {
    const listId = idParam.parse(req.params.id);
    const itemId = idParam.parse(req.params.itemId);
    const parsed = convertBody.parse(req.body);
    const list = await loadList(listId);
    if (!list) {
      sendError(res, 404, "not_found", "List not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessViaProject(db, actorId, list.projectId);
    const [item] = await db
      .select()
      .from(schema.todoListItems)
      .where(eq(schema.todoListItems.id, itemId));
    if (!item || item.listId !== listId) {
      sendError(res, 404, "not_found", "Item not found");
      return;
    }
    if (item.entityType !== "idea" && item.entityType !== "todo") {
      sendError(res, 400, "invalid_item", "Only idea or ToDo items can convert to tasks");
      return;
    }
    await assertCanAccessProject(db, actorId, parsed.projectId);

    const number = await allocateTaskNumber(db);
    let title: string;
    let description: string | null = null;
    let priority = "none";
    let state = "new";
    let dueDate: string | null = null;
    let color: string | null = null;
    let sourceType: "idea" | "todo" = "idea";
    let sourceId = item.entityId;

    if (item.entityType === "idea") {
      const [idea] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, item.entityId));
      if (!idea) {
        sendError(res, 404, "not_found", "Idea not found");
        return;
      }
      title = parsed.title?.trim() || idea.title;
      description = idea.body;
      sourceType = "idea";
      sourceId = idea.id;
    } else {
      const [todo] = await db.select().from(schema.todos).where(eq(schema.todos.id, item.entityId));
      if (!todo || todo.state === "deleted") {
        sendError(res, 404, "not_found", "ToDo not found");
        return;
      }
      title = parsed.title?.trim() || todo.title;
      description = todo.description;
      if (todo.actionBy) {
        const note = `Action by: ${todo.actionBy.toISOString()}`;
        description = description ? `${description}\n\n${note}` : note;
      }
      priority = todo.priority;
      state = todo.state;
      dueDate = todo.dueDate;
      color = todo.color;
      sourceType = "todo";
      sourceId = todo.id;
    }

    const [task] = await db
      .insert(schema.tasks)
      .values({
        projectId: parsed.projectId,
        phaseId: null,
        number,
        title,
        description,
        priority,
        state,
        dueDate,
        color,
        sortOrder: 0,
        createdById: actorId,
        updatedById: actorId,
        ownerId: actorId,
      })
      .returning();
    if (!task) {
      sendError(res, 500, "insert_failed", "Could not create task");
      return;
    }
    await copyTaggings(
      db,
      { entityType: sourceType, entityId: sourceId },
      { entityType: "task", entityId: task.id },
    );
    await db
      .update(schema.todoListItems)
      .set({
        entityType: "task",
        entityId: task.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.todoListItems.id, itemId));
    const match = (await hydrateItems(listId)).find((i) => i.id === itemId);
    res.json({ data: { item: match, task } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

/** Convert a legacy idea list item to a ToDo and rewrite the membership row. */
todoListsRouter.post("/:id/items/:itemId/convert-to-todo", async (req, res) => {
  try {
    const listId = idParam.parse(req.params.id);
    const itemId = idParam.parse(req.params.itemId);
    const parsed = convertToTodoBody.parse(req.body ?? {});
    const list = await loadList(listId);
    if (!list) {
      sendError(res, 404, "not_found", "List not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessViaProject(db, actorId, list.projectId);
    const [item] = await db
      .select()
      .from(schema.todoListItems)
      .where(eq(schema.todoListItems.id, itemId));
    if (!item || item.listId !== listId) {
      sendError(res, 404, "not_found", "Item not found");
      return;
    }
    if (item.entityType !== "idea") {
      sendError(res, 400, "invalid_item", "Only idea items can convert to ToDos");
      return;
    }
    const [idea] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, item.entityId));
    if (!idea) {
      sendError(res, 404, "not_found", "Idea not found");
      return;
    }
    const projectId =
      parsed.projectId !== undefined ? parsed.projectId : list.projectId;
    if (projectId != null) {
      await assertCanAccessProject(db, actorId, projectId);
    }
    const number = await allocateTodoNumber(db);
    const [todo] = await db
      .insert(schema.todos)
      .values({
        projectId,
        number,
        title: parsed.title?.trim() || idea.title,
        description: idea.body,
        sourceIdeaId: idea.id,
        sortOrder: 0,
        createdById: actorId,
        updatedById: actorId,
        ownerId: actorId,
      })
      .returning();
    if (!todo) {
      sendError(res, 500, "insert_failed", "Could not create ToDo");
      return;
    }
    await copyTaggings(
      db,
      { entityType: "idea", entityId: idea.id },
      { entityType: "todo", entityId: todo.id },
    );
    await db
      .update(schema.todoListItems)
      .set({
        entityType: "todo",
        entityId: todo.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.todoListItems.id, itemId));
    const match = (await hydrateItems(listId)).find((i) => i.id === itemId);
    res.json({ data: { item: match, todo } });
  } catch (err) {
    handleRouteError(res, err);
  }
});
