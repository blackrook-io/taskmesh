import { and, asc, count, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { hasDefinedKeys } from "../../lib/immutableFields.js";
import { parseRouteId } from "../../lib/routeParams.js";
import { loadBoardDetail, nextCardSort, seedDefaultColumns } from "../../services/boards.js";
import { allocateBoardNumber, allocateIdeaNumber } from "../../services/entityNumbers.js";
import { allocateTaskNumber } from "../../services/tasks.js";
import { getCurrentUserId } from "../../services/users.js";

const boardBody = z.object({
  name: z.string().min(1).max(500),
});

const boardPatch = z.object({
  name: z.string().min(1).max(500).optional(),
  sortOrder: z.number().int().optional(),
});

const boardsReorderBody = z.object({
  orderedBoardIds: z.array(z.number().int().positive()).min(1),
});

const columnBody = z.object({
  name: z.string().min(1).max(200),
  wipLimit: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().optional(),
  /** Insert at this index (0-based) and reindex siblings; overrides append/sortOrder. */
  insertAt: z.number().int().min(0).optional(),
});

const columnPatch = z.object({
  name: z.string().min(1).max(200).optional(),
  wipLimit: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const cardBody = z.object({
  columnId: z.number().int().positive(),
  entityType: z.enum(["task", "idea", "todo_list"]).default("task"),
  entityId: z.number().int().positive().optional(),
  /** Create a new task/idea (when entityType is task or idea) and place it on the board */
  title: z.string().min(1).max(2000).optional(),
  laneId: z.number().int().positive().nullable().optional(),
});

const moveBody = z.object({
  columnId: z.number().int().positive(),
  orderedCardIds: z.array(z.number().int().positive()),
  laneId: z.number().int().positive().nullable().optional(),
});

const columnsReorderBody = z.object({
  orderedColumnIds: z.array(z.number().int().positive()).min(1),
});

const laneBody = z.object({
  name: z.string().min(1).max(200),
  sortOrder: z.number().int().optional(),
  insertAt: z.number().int().min(0).optional(),
});

const lanePatch = z.object({
  name: z.string().min(1).max(200).optional(),
  sortOrder: z.number().int().optional(),
});

const lanesReorderBody = z.object({
  orderedLaneIds: z.array(z.number().int().positive()).min(1),
});

export const boardsRouter = Router({ mergeParams: true });

async function requireProject(projectId: number) {
  const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  return proj ?? null;
}

async function requireBoard(projectId: number, boardId: number) {
  const [board] = await db.select().from(schema.boards).where(eq(schema.boards.id, boardId));
  if (!board || board.projectId !== projectId) return null;
  return board;
}

boardsRouter.get("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    if (!(await requireProject(projectId))) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const rows = await db
      .select({
        id: schema.boards.id,
        projectId: schema.boards.projectId,
        name: schema.boards.name,
        sortOrder: schema.boards.sortOrder,
        createdAt: schema.boards.createdAt,
        updatedAt: schema.boards.updatedAt,
        cardCount: sql<number>`coalesce(count(${schema.boardCards.id}), 0)::int`,
      })
      .from(schema.boards)
      .leftJoin(schema.boardCards, eq(schema.boardCards.boardId, schema.boards.id))
      .where(eq(schema.boards.projectId, projectId))
      .groupBy(schema.boards.id)
      .orderBy(asc(schema.boards.sortOrder), asc(schema.boards.id));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

boardsRouter.post("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    if (!(await requireProject(projectId))) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const parsed = boardBody.parse(req.body);
    const existing = await db
      .select({ m: schema.boards.sortOrder })
      .from(schema.boards)
      .where(eq(schema.boards.projectId, projectId));
    const nextSort = existing.length ? Math.max(...existing.map((r) => r.m)) + 1 : 0;
    const number = await allocateBoardNumber(db);
    const [row] = await db
      .insert(schema.boards)
      .values({ number, projectId, name: parsed.name, sortOrder: nextSort })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create board");
      return;
    }
    await seedDefaultColumns(db, row.id);
    const detail = await loadBoardDetail(db, row.id);
    res.status(201).json({ data: detail });
  } catch (err) {
    handleRouteError(res, err);
  }
});

boardsRouter.patch("/reorder", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    if (!(await requireProject(projectId))) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const { orderedBoardIds } = boardsReorderBody.parse(req.body);
    const existing = await db
      .select({ id: schema.boards.id })
      .from(schema.boards)
      .where(eq(schema.boards.projectId, projectId));
    const allowed = new Set(existing.map((e) => e.id));
    if (
      orderedBoardIds.length !== allowed.size ||
      orderedBoardIds.some((id) => !allowed.has(id))
    ) {
      sendError(res, 400, "invalid_reorder", "orderedBoardIds must list every board exactly once");
      return;
    }
    for (let i = 0; i < orderedBoardIds.length; i++) {
      const id = orderedBoardIds[i];
      if (id === undefined) continue;
      await db
        .update(schema.boards)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(schema.boards.id, id));
    }
    const rows = await db
      .select()
      .from(schema.boards)
      .where(eq(schema.boards.projectId, projectId))
      .orderBy(asc(schema.boards.sortOrder), asc(schema.boards.id));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

boardsRouter.get("/:boardId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const boardId = parseRouteId(req, "boardId");
    if (!(await requireBoard(projectId, boardId))) {
      sendError(res, 404, "not_found", "Board not found");
      return;
    }
    const detail = await loadBoardDetail(db, boardId);
    res.json({ data: detail });
  } catch (err) {
    handleRouteError(res, err);
  }
});

boardsRouter.patch("/:boardId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const boardId = parseRouteId(req, "boardId");
    if (!(await requireBoard(projectId, boardId))) {
      sendError(res, 404, "not_found", "Board not found");
      return;
    }
    const parsed = boardPatch.parse(req.body);
    if (!hasDefinedKeys(parsed, ["name", "sortOrder"])) {
      sendError(res, 400, "empty_patch", "Provide name and/or sortOrder");
      return;
    }
    const [row] = await db
      .update(schema.boards)
      .set({
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.boards.id, boardId))
      .returning();
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

boardsRouter.delete("/:boardId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const boardId = parseRouteId(req, "boardId");
    if (!(await requireBoard(projectId, boardId))) {
      sendError(res, 404, "not_found", "Board not found");
      return;
    }
    const [agg] = await db
      .select({ value: count() })
      .from(schema.boardCards)
      .where(eq(schema.boardCards.boardId, boardId));
    if ((agg?.value ?? 0) > 0) {
      sendError(
        res,
        400,
        "board_not_empty",
        "Only empty boards can be deleted — remove all cards first",
      );
      return;
    }
    await db.delete(schema.boards).where(eq(schema.boards.id, boardId));
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});

boardsRouter.post("/:boardId/columns", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const boardId = parseRouteId(req, "boardId");
    if (!(await requireBoard(projectId, boardId))) {
      sendError(res, 404, "not_found", "Board not found");
      return;
    }
    const parsed = columnBody.parse(req.body);
    const existing = await db
      .select()
      .from(schema.boardColumns)
      .where(eq(schema.boardColumns.boardId, boardId))
      .orderBy(asc(schema.boardColumns.sortOrder), asc(schema.boardColumns.id));

    let insertIndex: number;
    if (parsed.insertAt !== undefined) {
      insertIndex = Math.min(parsed.insertAt, existing.length);
    } else if (parsed.sortOrder !== undefined) {
      insertIndex = Math.min(Math.max(0, parsed.sortOrder), existing.length);
    } else {
      insertIndex = existing.length;
    }

    const [row] = await db
      .insert(schema.boardColumns)
      .values({
        boardId,
        name: parsed.name,
        sortOrder: insertIndex,
        wipLimit: parsed.wipLimit ?? null,
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create column");
      return;
    }

    const orderedIds = [
      ...existing.slice(0, insertIndex).map((c) => c.id),
      row.id,
      ...existing.slice(insertIndex).map((c) => c.id),
    ];
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      if (id === undefined) continue;
      await db
        .update(schema.boardColumns)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(schema.boardColumns.id, id));
    }

    const [updated] = await db
      .select()
      .from(schema.boardColumns)
      .where(eq(schema.boardColumns.id, row.id));
    res.status(201).json({ data: updated ?? row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

boardsRouter.patch("/:boardId/columns/reorder", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const boardId = parseRouteId(req, "boardId");
    if (!(await requireBoard(projectId, boardId))) {
      sendError(res, 404, "not_found", "Board not found");
      return;
    }
    const { orderedColumnIds } = columnsReorderBody.parse(req.body);
    const existing = await db
      .select({ id: schema.boardColumns.id })
      .from(schema.boardColumns)
      .where(eq(schema.boardColumns.boardId, boardId));
    const allowed = new Set(existing.map((e) => e.id));
    if (orderedColumnIds.length !== allowed.size || orderedColumnIds.some((id) => !allowed.has(id))) {
      sendError(res, 400, "invalid_reorder", "orderedColumnIds must list every column exactly once");
      return;
    }
    for (let i = 0; i < orderedColumnIds.length; i++) {
      const id = orderedColumnIds[i];
      if (id === undefined) continue;
      await db
        .update(schema.boardColumns)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(schema.boardColumns.id, id));
    }
    const detail = await loadBoardDetail(db, boardId);
    res.json({ data: detail?.columns ?? [] });
  } catch (err) {
    handleRouteError(res, err);
  }
});

boardsRouter.patch("/:boardId/columns/:columnId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const boardId = parseRouteId(req, "boardId");
    const columnId = parseRouteId(req, "columnId");
    if (!(await requireBoard(projectId, boardId))) {
      sendError(res, 404, "not_found", "Board not found");
      return;
    }
    const [col] = await db
      .select()
      .from(schema.boardColumns)
      .where(eq(schema.boardColumns.id, columnId));
    if (!col || col.boardId !== boardId) {
      sendError(res, 404, "not_found", "Column not found");
      return;
    }
    const parsed = columnPatch.parse(req.body);
    if (!hasDefinedKeys(parsed, ["name", "wipLimit", "sortOrder"])) {
      sendError(res, 400, "empty_patch", "Provide name, wipLimit, and/or sortOrder");
      return;
    }
    const [row] = await db
      .update(schema.boardColumns)
      .set({
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.wipLimit !== undefined ? { wipLimit: parsed.wipLimit } : {}),
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.boardColumns.id, columnId))
      .returning();
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

boardsRouter.delete("/:boardId/columns/:columnId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const boardId = parseRouteId(req, "boardId");
    const columnId = parseRouteId(req, "columnId");
    if (!(await requireBoard(projectId, boardId))) {
      sendError(res, 404, "not_found", "Board not found");
      return;
    }
    const cols = await db
      .select()
      .from(schema.boardColumns)
      .where(eq(schema.boardColumns.boardId, boardId));
    if (cols.length <= 1) {
      sendError(res, 400, "last_column", "Board must keep at least one column");
      return;
    }
    const [col] = cols.filter((c) => c.id === columnId);
    if (!col) {
      sendError(res, 404, "not_found", "Column not found");
      return;
    }
    const fallback = cols.find((c) => c.id !== columnId)!;
    await db
      .update(schema.boardCards)
      .set({ columnId: fallback.id, updatedAt: new Date() })
      .where(eq(schema.boardCards.columnId, columnId));
    await db.delete(schema.boardColumns).where(eq(schema.boardColumns.id, columnId));
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});

boardsRouter.post("/:boardId/lanes", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const boardId = parseRouteId(req, "boardId");
    if (!(await requireBoard(projectId, boardId))) {
      sendError(res, 404, "not_found", "Board not found");
      return;
    }
    const parsed = laneBody.parse(req.body);
    const existing = await db
      .select()
      .from(schema.boardLanes)
      .where(eq(schema.boardLanes.boardId, boardId))
      .orderBy(asc(schema.boardLanes.sortOrder), asc(schema.boardLanes.id));

    let insertIndex: number;
    if (parsed.insertAt !== undefined) {
      insertIndex = Math.min(parsed.insertAt, existing.length);
    } else if (parsed.sortOrder !== undefined) {
      insertIndex = Math.min(Math.max(0, parsed.sortOrder), existing.length);
    } else {
      insertIndex = existing.length;
    }

    const [row] = await db
      .insert(schema.boardLanes)
      .values({
        boardId,
        name: parsed.name,
        sortOrder: insertIndex,
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create lane");
      return;
    }

    const orderedIds = [
      ...existing.slice(0, insertIndex).map((c) => c.id),
      row.id,
      ...existing.slice(insertIndex).map((c) => c.id),
    ];
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      if (id === undefined) continue;
      await db
        .update(schema.boardLanes)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(schema.boardLanes.id, id));
    }

    const [updated] = await db
      .select()
      .from(schema.boardLanes)
      .where(eq(schema.boardLanes.id, row.id));
    res.status(201).json({ data: updated ?? row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

boardsRouter.patch("/:boardId/lanes/reorder", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const boardId = parseRouteId(req, "boardId");
    if (!(await requireBoard(projectId, boardId))) {
      sendError(res, 404, "not_found", "Board not found");
      return;
    }
    const { orderedLaneIds } = lanesReorderBody.parse(req.body);
    const existing = await db
      .select({ id: schema.boardLanes.id })
      .from(schema.boardLanes)
      .where(eq(schema.boardLanes.boardId, boardId));
    const allowed = new Set(existing.map((e) => e.id));
    if (orderedLaneIds.length !== allowed.size || orderedLaneIds.some((id) => !allowed.has(id))) {
      sendError(res, 400, "invalid_reorder", "orderedLaneIds must list every lane exactly once");
      return;
    }
    for (let i = 0; i < orderedLaneIds.length; i++) {
      const id = orderedLaneIds[i];
      if (id === undefined) continue;
      await db
        .update(schema.boardLanes)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(schema.boardLanes.id, id));
    }
    const detail = await loadBoardDetail(db, boardId);
    res.json({ data: detail?.lanes ?? [] });
  } catch (err) {
    handleRouteError(res, err);
  }
});

boardsRouter.patch("/:boardId/lanes/:laneId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const boardId = parseRouteId(req, "boardId");
    const laneId = parseRouteId(req, "laneId");
    if (!(await requireBoard(projectId, boardId))) {
      sendError(res, 404, "not_found", "Board not found");
      return;
    }
    const [lane] = await db
      .select()
      .from(schema.boardLanes)
      .where(eq(schema.boardLanes.id, laneId));
    if (!lane || lane.boardId !== boardId) {
      sendError(res, 404, "not_found", "Lane not found");
      return;
    }
    const parsed = lanePatch.parse(req.body);
    if (!hasDefinedKeys(parsed, ["name", "sortOrder"])) {
      sendError(res, 400, "empty_patch", "Provide name and/or sortOrder");
      return;
    }
    const [row] = await db
      .update(schema.boardLanes)
      .set({
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.boardLanes.id, laneId))
      .returning();
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

boardsRouter.delete("/:boardId/lanes/:laneId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const boardId = parseRouteId(req, "boardId");
    const laneId = parseRouteId(req, "laneId");
    if (!(await requireBoard(projectId, boardId))) {
      sendError(res, 404, "not_found", "Board not found");
      return;
    }
    const [lane] = await db
      .select()
      .from(schema.boardLanes)
      .where(eq(schema.boardLanes.id, laneId));
    if (!lane || lane.boardId !== boardId) {
      sendError(res, 404, "not_found", "Lane not found");
      return;
    }
    await db
      .update(schema.boardCards)
      .set({ laneId: null, updatedAt: new Date() })
      .where(and(eq(schema.boardCards.boardId, boardId), eq(schema.boardCards.laneId, laneId)));
    await db.delete(schema.boardLanes).where(eq(schema.boardLanes.id, laneId));
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});

boardsRouter.post("/:boardId/cards", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const boardId = parseRouteId(req, "boardId");
    if (!(await requireBoard(projectId, boardId))) {
      sendError(res, 404, "not_found", "Board not found");
      return;
    }
    const parsed = cardBody.parse(req.body);
    const entityType = parsed.entityType;
    const [col] = await db
      .select()
      .from(schema.boardColumns)
      .where(eq(schema.boardColumns.id, parsed.columnId));
    if (!col || col.boardId !== boardId) {
      sendError(res, 404, "not_found", "Column not found");
      return;
    }

    let laneId = parsed.laneId ?? null;
    if (laneId != null) {
      const [lane] = await db
        .select()
        .from(schema.boardLanes)
        .where(eq(schema.boardLanes.id, laneId));
      if (!lane || lane.boardId !== boardId) {
        sendError(res, 404, "not_found", "Lane not found");
        return;
      }
    }

    let entityId = parsed.entityId;
    if (parsed.title?.trim()) {
      if (entityType === "task") {
        const number = await allocateTaskNumber(db);
        const actorId = await getCurrentUserId(db);
        const [task] = await db
          .insert(schema.tasks)
          .values({
            projectId,
            phaseId: null,
            number,
            title: parsed.title.trim(),
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
      } else if (entityType === "idea") {
        const ideaNumber = await allocateIdeaNumber(db);
        const [idea] = await db
          .insert(schema.ideas)
          .values({ number: ideaNumber, title: parsed.title.trim() })
          .returning();
        if (!idea) {
          sendError(res, 500, "insert_failed", "Could not create idea");
          return;
        }
        entityId = idea.id;
      } else {
        sendError(
          res,
          400,
          "validation_error",
          "Provide entityId to place a to-do list; title create is only for task or idea",
        );
        return;
      }
    }
    if (entityId == null) {
      sendError(res, 400, "validation_error", "Provide entityId or title to create a card");
      return;
    }

    if (entityType === "task") {
      const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, entityId));
      if (!task || task.projectId !== projectId || task.state === "deleted") {
        sendError(res, 404, "not_found", "Task not found on this project");
        return;
      }
    } else if (entityType === "idea") {
      const [idea] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, entityId));
      if (!idea) {
        sendError(res, 404, "not_found", "Idea not found");
        return;
      }
    } else if (entityType === "todo_list") {
      const [list] = await db
        .select()
        .from(schema.todoLists)
        .where(eq(schema.todoLists.id, entityId));
      if (!list || (list.projectId != null && list.projectId !== projectId)) {
        sendError(res, 404, "not_found", "To-do list not found for this project");
        return;
      }
    }

    if (col.wipLimit != null) {
      const inCol = await db
        .select({ id: schema.boardCards.id })
        .from(schema.boardCards)
        .where(
          and(eq(schema.boardCards.boardId, boardId), eq(schema.boardCards.columnId, col.id)),
        );
      if (inCol.length >= col.wipLimit) {
        sendError(res, 400, "wip_limit", `Column "${col.name}" is at its WIP limit (${col.wipLimit})`);
        return;
      }
    }

    const sortOrder = await nextCardSort(db, boardId, col.id, laneId);
    try {
      const [row] = await db
        .insert(schema.boardCards)
        .values({
          boardId,
          columnId: col.id,
          laneId,
          entityType,
          entityId,
          sortOrder,
        })
        .returning();
      if (!row) {
        sendError(res, 500, "insert_failed", "Could not add card");
        return;
      }
      const detail = await loadBoardDetail(db, boardId);
      const card = detail?.cards.find((c) => c.id === row.id);
      res.status(201).json({ data: card ?? row });
    } catch (insertErr) {
      const pg = insertErr as { code?: string };
      if (pg.code === "23505") {
        sendError(res, 409, "already_on_board", "That record is already on this board");
        return;
      }
      throw insertErr;
    }
  } catch (err) {
    handleRouteError(res, err);
  }
});

boardsRouter.patch("/:boardId/cards/move", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const boardId = parseRouteId(req, "boardId");
    if (!(await requireBoard(projectId, boardId))) {
      sendError(res, 404, "not_found", "Board not found");
      return;
    }
    const parsed = moveBody.parse(req.body);
    const [col] = await db
      .select()
      .from(schema.boardColumns)
      .where(eq(schema.boardColumns.id, parsed.columnId));
    if (!col || col.boardId !== boardId) {
      sendError(res, 404, "not_found", "Column not found");
      return;
    }

    if (parsed.laneId != null) {
      const [lane] = await db
        .select()
        .from(schema.boardLanes)
        .where(eq(schema.boardLanes.id, parsed.laneId));
      if (!lane || lane.boardId !== boardId) {
        sendError(res, 404, "not_found", "Lane not found");
        return;
      }
    }

    const existing = await db
      .select()
      .from(schema.boardCards)
      .where(eq(schema.boardCards.boardId, boardId));
    const byId = new Map(existing.map((c) => [c.id, c]));
    for (const id of parsed.orderedCardIds) {
      if (!byId.has(id)) {
        sendError(res, 400, "invalid_card", `Card ${id} is not on this board`);
        return;
      }
    }

    const targetLaneId = parsed.laneId !== undefined ? parsed.laneId : undefined;

    // WIP: count cards that will be in this column after the move
    if (col.wipLimit != null) {
      const moving = new Set(parsed.orderedCardIds);
      let count = parsed.orderedCardIds.length;
      for (const card of existing) {
        if (moving.has(card.id)) continue;
        if (card.columnId === col.id) count += 1;
      }
      // If lane-scoped move, cards already in column but other lanes still count toward WIP
      if (count > col.wipLimit) {
        sendError(res, 400, "wip_limit", `Column "${col.name}" WIP limit is ${col.wipLimit}`);
        return;
      }
    }

    for (let i = 0; i < parsed.orderedCardIds.length; i++) {
      const id = parsed.orderedCardIds[i];
      if (id === undefined) continue;
      await db
        .update(schema.boardCards)
        .set({
          columnId: col.id,
          sortOrder: i,
          ...(targetLaneId !== undefined ? { laneId: targetLaneId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.boardCards.id, id));
    }

    // Re-pack remaining cards in other (column, lane) cells that lost items
    const moved = new Set(parsed.orderedCardIds);
    const otherCells = new Map<string, typeof existing>();
    for (const card of existing) {
      if (moved.has(card.id)) continue;
      const key = `${card.columnId}:${card.laneId ?? "null"}`;
      const list = otherCells.get(key) ?? [];
      list.push(card);
      otherCells.set(key, list);
    }
    for (const [, list] of otherCells) {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
      for (let i = 0; i < list.length; i++) {
        const card = list[i]!;
        if (card.sortOrder !== i) {
          await db
            .update(schema.boardCards)
            .set({ sortOrder: i, updatedAt: new Date() })
            .where(eq(schema.boardCards.id, card.id));
        }
      }
    }

    res.json({ data: await loadBoardDetail(db, boardId) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

boardsRouter.delete("/:boardId/cards/:cardId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const boardId = parseRouteId(req, "boardId");
    const cardId = parseRouteId(req, "cardId");
    if (!(await requireBoard(projectId, boardId))) {
      sendError(res, 404, "not_found", "Board not found");
      return;
    }
    const deleted = await db
      .delete(schema.boardCards)
      .where(and(eq(schema.boardCards.id, cardId), eq(schema.boardCards.boardId, boardId)))
      .returning({ id: schema.boardCards.id });
    if (deleted.length === 0) {
      sendError(res, 404, "not_found", "Card not found");
      return;
    }
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});
