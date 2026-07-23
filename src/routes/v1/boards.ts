import { and, asc, count, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { parseRouteId } from "../../lib/routeParams.js";
import { ensureDefaultPhase } from "../../services/phases.js";
import { loadBoardDetail, nextCardSort, seedDefaultColumns } from "../../services/boards.js";

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
});

const columnPatch = z.object({
  name: z.string().min(1).max(200).optional(),
  wipLimit: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const cardBody = z.object({
  columnId: z.number().int().positive(),
  entityType: z.enum(["task"]),
  entityId: z.number().int().positive().optional(),
  /** Create a new task on the project and place it on the board */
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
    const [row] = await db
      .insert(schema.boards)
      .values({ projectId, name: parsed.name, sortOrder: nextSort })
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
    const [row] = await db
      .update(schema.boards)
      .set({ ...parsed, updatedAt: new Date() })
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
      .select({ m: schema.boardColumns.sortOrder })
      .from(schema.boardColumns)
      .where(eq(schema.boardColumns.boardId, boardId));
    const nextSort =
      parsed.sortOrder ?? (existing.length ? Math.max(...existing.map((r) => r.m)) + 1 : 0);
    const [row] = await db
      .insert(schema.boardColumns)
      .values({
        boardId,
        name: parsed.name,
        sortOrder: nextSort,
        wipLimit: parsed.wipLimit ?? null,
      })
      .returning();
    res.status(201).json({ data: row });
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

boardsRouter.post("/:boardId/cards", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const boardId = parseRouteId(req, "boardId");
    if (!(await requireBoard(projectId, boardId))) {
      sendError(res, 404, "not_found", "Board not found");
      return;
    }
    const parsed = cardBody.parse(req.body);
    const [col] = await db
      .select()
      .from(schema.boardColumns)
      .where(eq(schema.boardColumns.id, parsed.columnId));
    if (!col || col.boardId !== boardId) {
      sendError(res, 404, "not_found", "Column not found");
      return;
    }

    let entityId = parsed.entityId;
    if (parsed.title?.trim()) {
      const phaseId = await ensureDefaultPhase(db, projectId);
      const [task] = await db
        .insert(schema.tasks)
        .values({
          projectId,
          phaseId,
          title: parsed.title.trim(),
          sortOrder: 0,
        })
        .returning();
      if (!task) {
        sendError(res, 500, "insert_failed", "Could not create task");
        return;
      }
      entityId = task.id;
    }
    if (entityId == null) {
      sendError(res, 400, "validation_error", "Provide entityId or title to create a task");
      return;
    }

    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, entityId));
    if (!task || task.projectId !== projectId) {
      sendError(res, 404, "not_found", "Task not found on this project");
      return;
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

    const sortOrder = await nextCardSort(db, boardId, col.id);
    try {
      const [row] = await db
        .insert(schema.boardCards)
        .values({
          boardId,
          columnId: col.id,
          laneId: parsed.laneId ?? null,
          entityType: "task",
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
        sendError(res, 409, "already_on_board", "That task is already on this board");
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

    if (col.wipLimit != null && parsed.orderedCardIds.length > col.wipLimit) {
      sendError(res, 400, "wip_limit", `Column "${col.name}" WIP limit is ${col.wipLimit}`);
      return;
    }

    for (let i = 0; i < parsed.orderedCardIds.length; i++) {
      const id = parsed.orderedCardIds[i];
      if (id === undefined) continue;
      await db
        .update(schema.boardCards)
        .set({
          columnId: col.id,
          sortOrder: i,
          ...(parsed.laneId !== undefined ? { laneId: parsed.laneId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.boardCards.id, id));
    }

    // Re-pack remaining cards in other columns that lost items
    const moved = new Set(parsed.orderedCardIds);
    const otherCols = new Map<number, typeof existing>();
    for (const card of existing) {
      if (moved.has(card.id)) continue;
      const list = otherCols.get(card.columnId) ?? [];
      list.push(card);
      otherCols.set(card.columnId, list);
    }
    for (const [, list] of otherCols) {
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
