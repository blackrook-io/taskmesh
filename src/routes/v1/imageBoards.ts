import { and, asc, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { optionalPlainTitle } from "../../lib/markdownFields.js";
import { jsonDocumentSchema } from "../../lib/jsonDocument.js";
import { parseRouteId } from "../../lib/routeParams.js";
import { allocateImageBoardNumber } from "../../services/entityNumbers.js";
import {
  assertCanAccessProject,
  assertCanAccessViaProject,
  dualScopeListFilter,
} from "../../services/ownership.js";
import { userHasAdministrator } from "../../services/roles.js";
import { getCurrentUserId } from "../../services/users.js";

const emptyDocument = {
  camera: { x: 0, y: 0, zoom: 1 },
  gridVisible: false,
  items: [],
};

const createBody = z.object({
  title: optionalPlainTitle(500),
  projectId: z.number().int().positive().nullable().optional(),
  document: jsonDocumentSchema.optional(),
});

const patchBody = z.object({
  title: optionalPlainTitle(500),
  projectId: z.number().int().positive().nullable().optional(),
  document: jsonDocumentSchema.optional(),
  sortOrder: z.number().int().optional(),
});

const reorderBody = z.object({
  orderedIds: z.array(z.number().int().positive()).min(1),
});

const listQuery = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  standalone: z
    .enum(["1", "true", "yes"])
    .optional()
    .transform((v) => v != null),
});

export const imageBoardsRouter = Router();

const summarySelect = {
  id: schema.imageBoards.id,
  projectId: schema.imageBoards.projectId,
  title: schema.imageBoards.title,
  sortOrder: schema.imageBoards.sortOrder,
  createdAt: schema.imageBoards.createdAt,
  updatedAt: schema.imageBoards.updatedAt,
  projectName: schema.projects.name,
};

async function requireBoard(id: number) {
  const [row] = await db.select().from(schema.imageBoards).where(eq(schema.imageBoards.id, id));
  return row ?? null;
}

async function nextSortOrder(projectId: number | null) {
  const rows =
    projectId == null
      ? await db
          .select({ m: schema.imageBoards.sortOrder })
          .from(schema.imageBoards)
          .where(isNull(schema.imageBoards.projectId))
      : await db
          .select({ m: schema.imageBoards.sortOrder })
          .from(schema.imageBoards)
          .where(eq(schema.imageBoards.projectId, projectId));
  return rows.length ? Math.max(...rows.map((r) => r.m)) + 1 : 0;
}

imageBoardsRouter.get("/", async (req, res) => {
  try {
    const q = listQuery.parse(req.query);
    if (q.projectId != null && q.standalone) {
      sendError(res, 400, "invalid_query", "Use projectId or standalone, not both");
      return;
    }
    const actorId = await getCurrentUserId(db);
    const isAdmin = await userHasAdministrator(db, actorId);

    const filters = [];
    if (q.projectId != null) {
      await assertCanAccessProject(db, actorId, q.projectId);
      filters.push(eq(schema.imageBoards.projectId, q.projectId));
    } else if (q.standalone) {
      filters.push(isNull(schema.imageBoards.projectId));
    } else {
      const scope = dualScopeListFilter(db, schema.imageBoards.projectId, actorId, isAdmin);
      if (scope) filters.push(scope);
    }

    const rows = await db
      .select(summarySelect)
      .from(schema.imageBoards)
      .leftJoin(schema.projects, eq(schema.imageBoards.projectId, schema.projects.id))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(schema.imageBoards.sortOrder), asc(schema.imageBoards.id));

    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

imageBoardsRouter.post("/", async (req, res) => {
  try {
    const parsed = createBody.parse(req.body);
    const projectId = parsed.projectId === undefined ? null : parsed.projectId;
    const actorId = await getCurrentUserId(db);
    if (projectId != null) {
      await assertCanAccessProject(db, actorId, projectId);
    }
    const sortOrder = await nextSortOrder(projectId);
    const number = await allocateImageBoardNumber(db);
    const ownerId = actorId;
    const [row] = await db
      .insert(schema.imageBoards)
      .values({
        number,
        projectId,
        title: parsed.title?.trim() || "Untitled image board",
        sortOrder,
        document: parsed.document ?? emptyDocument,
        ownerId,
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create image board");
      return;
    }
    const [withName] = await db
      .select(summarySelect)
      .from(schema.imageBoards)
      .leftJoin(schema.projects, eq(schema.imageBoards.projectId, schema.projects.id))
      .where(eq(schema.imageBoards.id, row.id));
    res.status(201).json({ data: { ...row, projectName: withName?.projectName ?? null } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

imageBoardsRouter.patch("/reorder", async (req, res) => {
  try {
    const { orderedIds } = reorderBody.parse(req.body);
    const actorId = await getCurrentUserId(db);
    const isAdmin = await userHasAdministrator(db, actorId);
    const scope = dualScopeListFilter(db, schema.imageBoards.projectId, actorId, isAdmin);
    const existing = await db
      .select({ id: schema.imageBoards.id })
      .from(schema.imageBoards)
      .where(scope);
    const allowed = new Set(existing.map((r) => r.id));
    if (orderedIds.length !== allowed.size || orderedIds.some((id) => !allowed.has(id))) {
      sendError(
        res,
        400,
        "invalid_reorder",
        isAdmin
          ? "orderedIds must list every image board exactly once"
          : "orderedIds must list every image board you can access exactly once",
      );
      return;
    }
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i]!;
      await db
        .update(schema.imageBoards)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(schema.imageBoards.id, id));
    }
    const rows = await db
      .select(summarySelect)
      .from(schema.imageBoards)
      .leftJoin(schema.projects, eq(schema.imageBoards.projectId, schema.projects.id))
      .where(scope)
      .orderBy(asc(schema.imageBoards.sortOrder), asc(schema.imageBoards.id));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});
imageBoardsRouter.get("/:imageBoardId", async (req, res) => {
  try {
    const id = parseRouteId(req, "imageBoardId");
    const [row] = await db
      .select({
        ...summarySelect,
        document: schema.imageBoards.document,
      })
      .from(schema.imageBoards)
      .leftJoin(schema.projects, eq(schema.imageBoards.projectId, schema.projects.id))
      .where(eq(schema.imageBoards.id, id));
    if (!row) {
      sendError(res, 404, "not_found", "Image board not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessViaProject(db, actorId, row.projectId);
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

imageBoardsRouter.patch("/:imageBoardId", async (req, res) => {
  try {
    const id = parseRouteId(req, "imageBoardId");
    const existing = await requireBoard(id);
    if (!existing) {
      sendError(res, 404, "not_found", "Image board not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessViaProject(db, actorId, existing.projectId);
    const parsed = patchBody.parse(req.body);
    if (
      parsed.title === undefined &&
      parsed.document === undefined &&
      parsed.sortOrder === undefined &&
      parsed.projectId === undefined
    ) {
      sendError(res, 400, "empty_patch", "Provide title, document, sortOrder, and/or projectId");
      return;
    }
    if (parsed.projectId != null) {
      await assertCanAccessProject(db, actorId, parsed.projectId);
    }

    const [row] = await db
      .update(schema.imageBoards)
      .set({
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.document !== undefined ? { document: parsed.document } : {}),
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
        ...(parsed.projectId !== undefined ? { projectId: parsed.projectId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.imageBoards.id, id))
      .returning();

    const [withName] = await db
      .select(summarySelect)
      .from(schema.imageBoards)
      .leftJoin(schema.projects, eq(schema.imageBoards.projectId, schema.projects.id))
      .where(eq(schema.imageBoards.id, id));

    res.json({
      data: {
        ...row,
        projectName: withName?.projectName ?? null,
      },
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

imageBoardsRouter.delete("/:imageBoardId", async (req, res) => {
  try {
    const id = parseRouteId(req, "imageBoardId");
    const existing = await requireBoard(id);
    if (!existing) {
      sendError(res, 404, "not_found", "Image board not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessViaProject(db, actorId, existing.projectId);
    await db.delete(schema.imageBoards).where(eq(schema.imageBoards.id, id));
    res.status(204).send();
  } catch (err) {
    handleRouteError(res, err);
  }
});
