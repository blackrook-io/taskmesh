import { desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { optionalMarkdown, optionalPlainTitle, plainTitle } from "../../lib/markdownFields.js";
import { hasDefinedKeys } from "../../lib/immutableFields.js";
import { allocateIdeaNumber, allocateProjectNumber } from "../../services/entityNumbers.js";
import {
  assertCanAccessOwned,
  ownerScope,
} from "../../services/ownership.js";
import { nextProjectSortOrder } from "../../services/projectSortOrder.js";
import { userHasAdministrator } from "../../services/roles.js";
import { getCurrentUserId } from "../../services/users.js";

const ideaBody = z.object({
  title: plainTitle(500),
  body: optionalMarkdown(500_000),
});

const ideaPatch = z.object({
  title: optionalPlainTitle(500),
  body: optionalMarkdown(500_000),
});

const idParam = z.coerce.number().int().positive();

export const ideasRouter = Router();

ideasRouter.get("/", async (_req, res) => {
  try {
    const actorId = await getCurrentUserId(db);
    const isAdmin = await userHasAdministrator(db, actorId);
    const scope = ownerScope(schema.ideas.ownerId, actorId, isAdmin);
    const rows = await db
      .select()
      .from(schema.ideas)
      .where(scope)
      .orderBy(desc(schema.ideas.updatedAt));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

ideasRouter.post("/", async (req, res) => {
  try {
    const parsed = ideaBody.parse(req.body);
    const number = await allocateIdeaNumber(db);
    const ownerId = await getCurrentUserId(db);
    const [row] = await db
      .insert(schema.ideas)
      .values({
        number,
        title: parsed.title,
        body: parsed.body ?? null,
        ownerId,
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
    const actorId = await getCurrentUserId(db);
    const [row] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, id));
    if (!row) {
      sendError(res, 404, "not_found", "Idea not found");
      return;
    }
    await assertCanAccessOwned(db, actorId, row.ownerId);
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
    const actorId = await getCurrentUserId(db);
    const [existing] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, id));
    if (!existing) {
      sendError(res, 404, "not_found", "Idea not found");
      return;
    }
    await assertCanAccessOwned(db, actorId, existing.ownerId);
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
    const actorId = await getCurrentUserId(db);
    const [existing] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, id));
    if (!existing) {
      sendError(res, 404, "not_found", "Idea not found");
      return;
    }
    await assertCanAccessOwned(db, actorId, existing.ownerId);
    await db.delete(schema.ideas).where(eq(schema.ideas.id, id));
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});

ideasRouter.post("/:id/convert-to-project", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const actorId = await getCurrentUserId(db);
    const [idea] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, id));
    if (!idea) {
      sendError(res, 404, "not_found", "Idea not found");
      return;
    }
    await assertCanAccessOwned(db, actorId, idea.ownerId);

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
        ownerId: actorId,
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
