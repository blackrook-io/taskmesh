import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { hasDefinedKeys } from "../../lib/immutableFields.js";
import { allocateTaskNumber } from "../../services/tasks.js";
import { ensureInboxList } from "../../services/todoLists.js";
import { getCurrentUserId } from "../../services/users.js";

const listBody = z.object({
  title: z.string().min(1).max(500),
  projectId: z.number().int().positive().optional().nullable(),
});

const listPatch = z.object({
  title: z.string().min(1).max(500).optional(),
});

const itemEntity = z.enum(["idea", "task"]);

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
  title: z.string().min(1).max(2000),
  projectId: z.number().int().positive().optional(),
});

const convertBody = z.object({
  projectId: z.number().int().positive(),
  title: z.string().min(1).max(2000).optional(),
});

const idParam = z.coerce.number().int().positive();

export const todoListsRouter = Router();

async function loadList(listId: number) {
  const [list] = await db.select().from(schema.todoLists).where(eq(schema.todoLists.id, listId));
  return list ?? null;
}

/** Ideas/tasks not on any named list; tasks also must have no project. */
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

  const listedIdeas = new Set(
    listed.filter((r) => r.entityType === "idea").map((r) => r.entityId),
  );
  const listedTasks = new Set(
    listed.filter((r) => r.entityType === "task").map((r) => r.entityId),
  );

  const ideas = await db.select().from(schema.ideas).orderBy(asc(schema.ideas.id));
  const tasks = await db
    .select()
    .from(schema.tasks)
    .where(isNull(schema.tasks.projectId))
    .orderBy(asc(schema.tasks.id));

  const out = [];
  let sort = 0;
  for (const idea of ideas) {
    if (listedIdeas.has(idea.id)) continue;
    out.push({
      id: -(sort + 1),
      listId: inboxListId,
      entityType: "idea" as const,
      entityId: idea.id,
      sortOrder: sort++,
      checked: false,
      createdAt: idea.createdAt,
      updatedAt: idea.updatedAt,
      title: idea.title,
      href: `/ideas/${idea.id}`,
      virtual: true,
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
    if (row.entityType === "idea") {
      const [idea] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, row.entityId));
      if (idea) {
        title = idea.title;
        href = `/ideas/${idea.id}`;
      }
    } else if (row.entityType === "task") {
      const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, row.entityId));
      if (task) {
        title = task.title;
        href = task.projectId != null ? `/projects/${task.projectId}?tab=tasks` : null;
        state = task.state;
        dueDate = task.dueDate;
      }
    }
    out.push({ ...row, title, href, state, dueDate });
  }
  return out;
}

todoListsRouter.get("/", async (req, res) => {
  try {
    await ensureInboxList(db);
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
      rows = await db
        .select()
        .from(schema.todoLists)
        .where(eq(schema.todoLists.projectId, projectId))
        .orderBy(asc(schema.todoLists.id));
    } else {
      rows = await db.select().from(schema.todoLists).orderBy(asc(schema.todoLists.id));
    }
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

todoListsRouter.post("/", async (req, res) => {
  try {
    const parsed = listBody.parse(req.body);
    if (parsed.projectId != null) {
      const [proj] = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, parsed.projectId));
      if (!proj) {
        sendError(res, 404, "not_found", "Project not found");
        return;
      }
    }
    const [row] = await db
      .insert(schema.todoLists)
      .values({
        title: parsed.title,
        projectId: parsed.projectId ?? null,
        kind: "list",
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
    if (!(await loadList(id))) {
      sendError(res, 404, "not_found", "List not found");
      return;
    }
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
    if (parsed.entityType === "idea") {
      const [idea] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, parsed.entityId));
      if (!idea) {
        sendError(res, 404, "not_found", "Idea not found");
        return;
      }
    } else {
      const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, parsed.entityId));
      if (!task) {
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

/** Create a new idea or task and append it to this list. */
todoListsRouter.post("/:id/items/create", async (req, res) => {
  try {
    const listId = idParam.parse(req.params.id);
    const list = await loadList(listId);
    if (!list) {
      sendError(res, 404, "not_found", "List not found");
      return;
    }
    const parsed = createItemBody.parse(req.body);
    const title = parsed.title.trim();
    let entityType = parsed.entityType;
    let entityId: number;

    if (entityType === "idea") {
      const [idea] = await db.insert(schema.ideas).values({ title, body: null }).returning();
      if (!idea) {
        sendError(res, 500, "insert_failed", "Could not create idea");
        return;
      }
      entityId = idea.id;
    } else {
      const projectId = parsed.projectId ?? list.projectId ?? null;
      let phaseId: number | null = null;
      if (projectId != null) {
        const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
        if (!proj) {
          sendError(res, 404, "not_found", "Project not found");
          return;
        }
      }
      const number = await allocateTaskNumber(db);
      const actorId = await getCurrentUserId(db);
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

/** Create a task from an idea on this list (or a title) and replace/add as task item. */
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
    const [item] = await db
      .select()
      .from(schema.todoListItems)
      .where(eq(schema.todoListItems.id, itemId));
    if (!item || item.listId !== listId) {
      sendError(res, 404, "not_found", "Item not found");
      return;
    }
    if (item.entityType !== "idea") {
      sendError(res, 400, "invalid_item", "Only idea items can convert to tasks");
      return;
    }
    const [idea] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, item.entityId));
    if (!idea) {
      sendError(res, 404, "not_found", "Idea not found");
      return;
    }
    const [proj] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, parsed.projectId));
    if (!proj) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const number = await allocateTaskNumber(db);
    const actorId = await getCurrentUserId(db);
    const [task] = await db
      .insert(schema.tasks)
      .values({
        projectId: parsed.projectId,
        phaseId: null,
        number,
        title: parsed.title?.trim() || idea.title,
        description: idea.body,
        sortOrder: 0,
        createdById: actorId,
        updatedById: actorId,
      })
      .returning();
    if (!task) {
      sendError(res, 500, "insert_failed", "Could not create task");
      return;
    }
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
