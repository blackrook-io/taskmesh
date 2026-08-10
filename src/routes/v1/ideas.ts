import { desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { hasDefinedKeys } from "../../lib/immutableFields.js";
import { allocateIdeaNumber, allocateProjectNumber } from "../../services/entityNumbers.js";
import { nextProjectSortOrder } from "../../services/projectSortOrder.js";

const ideaBody = z.object({
  title: z.string().min(1).max(500),
  body: z.string().max(500_000).optional().nullable(),
});

const ideaPatch = z.object({
  title: z.string().min(1).max(500).optional(),
  body: z.string().max(500_000).optional().nullable(),
});

const idParam = z.coerce.number().int().positive();

export const ideasRouter = Router();

ideasRouter.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(schema.ideas).orderBy(desc(schema.ideas.updatedAt));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

ideasRouter.post("/", async (req, res) => {
  try {
    const parsed = ideaBody.parse(req.body);
    const number = await allocateIdeaNumber(db);
    const [row] = await db
      .insert(schema.ideas)
      .values({
        number,
        title: parsed.title,
        body: parsed.body ?? null,
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create idea");
      return;
    }
    res.status(201).json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

ideasRouter.get("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const [row] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, id));
    if (!row) {
      sendError(res, 404, "not_found", "Idea not found");
      return;
    }
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

ideasRouter.patch("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const parsed = ideaPatch.parse(req.body);
    if (!hasDefinedKeys(parsed, ["title", "body"])) {
      sendError(res, 400, "empty_patch", "Provide title and/or body");
      return;
    }
    const [existing] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, id));
    if (!existing) {
      sendError(res, 404, "not_found", "Idea not found");
      return;
    }
    const [row] = await db
      .update(schema.ideas)
      .set({
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.body !== undefined ? { body: parsed.body } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.ideas.id, id))
      .returning();
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

ideasRouter.delete("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const deleted = await db.delete(schema.ideas).where(eq(schema.ideas.id, id)).returning({ id: schema.ideas.id });
    if (deleted.length === 0) {
      sendError(res, 404, "not_found", "Idea not found");
      return;
    }
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});

ideasRouter.post("/:id/convert-to-project", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const [idea] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, id));
    if (!idea) {
      sendError(res, 404, "not_found", "Idea not found");
      return;
    }

    const number = await allocateProjectNumber(db);
    const sortOrder = await nextProjectSortOrder(db);
    const [project] = await db
      .insert(schema.projects)
      .values({
        number,
        name: idea.title,
        description: idea.body,
        status: "idea",
        sourceIdeaId: idea.id,
        sortOrder,
      })
      .returning();

    if (!project) {
      sendError(res, 500, "insert_failed", "Could not create project");
      return;
    }

    res.status(201).json({ data: project });
  } catch (err) {
    handleRouteError(res, err);
  }
});
