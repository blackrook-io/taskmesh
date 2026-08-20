import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { hasDefinedKeys } from "../../lib/immutableFields.js";
import { optionalMarkdown, optionalPlainTitle, plainTitle } from "../../lib/markdownFields.js";
import { parseRouteId } from "../../lib/routeParams.js";
import { allocateDocumentNumber } from "../../services/entityNumbers.js";

const docBody = z.object({
  title: plainTitle(500),
  body: optionalMarkdown(500_000),
  position: z.number().int().optional(),
});

const docPatch = z.object({
  title: optionalPlainTitle(500),
  body: optionalMarkdown(500_000),
  position: z.number().int().optional(),
});

export const documentsRouter = Router({ mergeParams: true });

documentsRouter.get("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!proj) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const rows = await db
      .select()
      .from(schema.projectDocuments)
      .where(eq(schema.projectDocuments.projectId, projectId))
      .orderBy(asc(schema.projectDocuments.position), asc(schema.projectDocuments.id));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

documentsRouter.post("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!proj) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const parsed = docBody.parse(req.body);
    const maxPos = await db
      .select({ p: schema.projectDocuments.position })
      .from(schema.projectDocuments)
      .where(eq(schema.projectDocuments.projectId, projectId));
    const nextPos =
      parsed.position ?? (maxPos.length ? Math.max(...maxPos.map((r) => r.p)) + 1 : 0);

    const number = await allocateDocumentNumber(db);
    const [row] = await db
      .insert(schema.projectDocuments)
      .values({
        number,
        projectId,
        title: parsed.title,
        body: parsed.body ?? null,
        position: nextPos,
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create document");
      return;
    }
    res.status(201).json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

documentsRouter.get("/:docId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const docId = parseRouteId(req, "docId");
    const [row] = await db.select().from(schema.projectDocuments).where(eq(schema.projectDocuments.id, docId));
    if (!row || row.projectId !== projectId) {
      sendError(res, 404, "not_found", "Document not found");
      return;
    }
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

documentsRouter.patch("/:docId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const docId = parseRouteId(req, "docId");
    const parsed = docPatch.parse(req.body);
    if (!hasDefinedKeys(parsed, ["title", "body", "position"])) {
      sendError(res, 400, "empty_patch", "Provide title, body, and/or position");
      return;
    }
    const [existing] = await db
      .select()
      .from(schema.projectDocuments)
      .where(eq(schema.projectDocuments.id, docId));
    if (!existing || existing.projectId !== projectId) {
      sendError(res, 404, "not_found", "Document not found");
      return;
    }
    const [row] = await db
      .update(schema.projectDocuments)
      .set({
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.body !== undefined ? { body: parsed.body } : {}),
        ...(parsed.position !== undefined ? { position: parsed.position } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.projectDocuments.id, docId))
      .returning();
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

documentsRouter.delete("/:docId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const docId = parseRouteId(req, "docId");
    const deleted = await db
      .delete(schema.projectDocuments)
      .where(eq(schema.projectDocuments.id, docId))
      .returning({ id: schema.projectDocuments.id, projectId: schema.projectDocuments.projectId });
    const d = deleted[0];
    if (!d || d.projectId !== projectId) {
      sendError(res, 404, "not_found", "Document not found");
      return;
    }
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});
