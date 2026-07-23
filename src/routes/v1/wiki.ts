import { and, asc, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { parseRouteId } from "../../lib/routeParams.js";
import {
  breadcrumbFor,
  buildWikiTree,
  listWikiNodes,
  nextWikiSort,
  wouldCreateCycle,
} from "../../services/wiki.js";

const entityType = z.enum(["document", "canvas"]);

const createPageBody = z.object({
  title: z.string().min(1).max(500),
  parentId: z.number().int().positive().nullable().optional(),
  body: z.string().max(500_000).optional().nullable(),
});

const linkBody = z.object({
  entityType,
  entityId: z.number().int().positive(),
  title: z.string().min(1).max(500).optional(),
  parentId: z.number().int().positive().nullable().optional(),
});

const nodePatch = z.object({
  title: z.string().min(1).max(500).optional(),
  pinned: z.boolean().optional(),
});

const moveBody = z.object({
  parentId: z.number().int().positive().nullable(),
  orderedSiblingIds: z.array(z.number().int().positive()),
});

export const wikiRouter = Router({ mergeParams: true });

async function requireProject(projectId: number) {
  const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  return proj ?? null;
}

async function requireNode(projectId: number, nodeId: number) {
  const [node] = await db.select().from(schema.wikiNodes).where(eq(schema.wikiNodes.id, nodeId));
  if (!node || node.projectId !== projectId) return null;
  return node;
}

wikiRouter.get("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    if (!(await requireProject(projectId))) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const rows = await listWikiNodes(db, projectId);
    res.json({ data: { nodes: rows, tree: buildWikiTree(rows) } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

const createCanvasPageBody = z.object({
  title: z.string().min(1).max(500),
  parentId: z.number().int().positive().nullable().optional(),
});

/** Create a Markdown document and attach it as a wiki node. */
wikiRouter.post("/pages", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    if (!(await requireProject(projectId))) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const parsed = createPageBody.parse(req.body);
    const parentId = parsed.parentId ?? null;
    if (parentId != null) {
      if (!(await requireNode(projectId, parentId))) {
        sendError(res, 404, "not_found", "Parent node not found");
        return;
      }
    }

    const docs = await db
      .select({ m: schema.projectDocuments.position })
      .from(schema.projectDocuments)
      .where(eq(schema.projectDocuments.projectId, projectId));
    const nextPos = docs.length ? Math.max(...docs.map((d) => d.m)) + 1 : 0;
    const [doc] = await db
      .insert(schema.projectDocuments)
      .values({
        projectId,
        title: parsed.title,
        body: parsed.body ?? "",
        position: nextPos,
      })
      .returning();
    if (!doc) {
      sendError(res, 500, "insert_failed", "Could not create document");
      return;
    }

    const sortOrder = await nextWikiSort(db, projectId, parentId);
    const [node] = await db
      .insert(schema.wikiNodes)
      .values({
        projectId,
        parentId,
        entityType: "document",
        entityId: doc.id,
        title: parsed.title,
        sortOrder,
      })
      .returning();
    if (!node) {
      sendError(res, 500, "insert_failed", "Could not create wiki node");
      return;
    }
    res.status(201).json({ data: { node, document: doc } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

/** Create a canvas and attach it as a wiki node. */
wikiRouter.post("/canvases", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    if (!(await requireProject(projectId))) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const parsed = createCanvasPageBody.parse(req.body);
    const parentId = parsed.parentId ?? null;
    if (parentId != null) {
      if (!(await requireNode(projectId, parentId))) {
        sendError(res, 404, "not_found", "Parent node not found");
        return;
      }
    }

    const [canvas] = await db
      .insert(schema.canvases)
      .values({
        projectId,
        title: parsed.title,
        document: {},
      })
      .returning();
    if (!canvas) {
      sendError(res, 500, "insert_failed", "Could not create canvas");
      return;
    }

    const sortOrder = await nextWikiSort(db, projectId, parentId);
    const [node] = await db
      .insert(schema.wikiNodes)
      .values({
        projectId,
        parentId,
        entityType: "canvas",
        entityId: canvas.id,
        title: parsed.title,
        sortOrder,
      })
      .returning();
    if (!node) {
      sendError(res, 500, "insert_failed", "Could not create wiki node");
      return;
    }
    res.status(201).json({ data: { node, canvas } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

/** Link an existing document or canvas into the wiki. */
wikiRouter.post("/nodes", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    if (!(await requireProject(projectId))) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const parsed = linkBody.parse(req.body);
    const parentId = parsed.parentId ?? null;
    if (parentId != null && !(await requireNode(projectId, parentId))) {
      sendError(res, 404, "not_found", "Parent node not found");
      return;
    }

    let title = parsed.title?.trim() ?? "";
    if (parsed.entityType === "document") {
      const [doc] = await db
        .select()
        .from(schema.projectDocuments)
        .where(eq(schema.projectDocuments.id, parsed.entityId));
      if (!doc || doc.projectId !== projectId) {
        sendError(res, 404, "not_found", "Document not found");
        return;
      }
      if (!title) title = doc.title;
    } else if (parsed.entityType === "canvas") {
      const [canvas] = await db
        .select()
        .from(schema.canvases)
        .where(eq(schema.canvases.id, parsed.entityId));
      if (!canvas || canvas.projectId !== projectId) {
        sendError(res, 404, "not_found", "Canvas not found");
        return;
      }
      if (!title) title = canvas.title;
    } else {
      sendError(res, 400, "unsupported_entity", "Unsupported wiki entity type");
      return;
    }

    const sortOrder = await nextWikiSort(db, projectId, parentId);
    try {
      const [node] = await db
        .insert(schema.wikiNodes)
        .values({
          projectId,
          parentId,
          entityType: parsed.entityType,
          entityId: parsed.entityId,
          title,
          sortOrder,
        })
        .returning();
      res.status(201).json({ data: node });
    } catch (insertErr) {
      const pg = insertErr as { code?: string };
      if (pg.code === "23505") {
        sendError(res, 409, "already_in_wiki", "That page is already in this wiki");
        return;
      }
      throw insertErr;
    }
  } catch (err) {
    handleRouteError(res, err);
  }
});

wikiRouter.get("/nodes/:nodeId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const nodeId = parseRouteId(req, "nodeId");
    const node = await requireNode(projectId, nodeId);
    if (!node) {
      sendError(res, 404, "not_found", "Node not found");
      return;
    }
    const rows = await listWikiNodes(db, projectId);
    let document = null;
    let canvas = null;
    if (node.entityType === "document") {
      const [doc] = await db
        .select()
        .from(schema.projectDocuments)
        .where(eq(schema.projectDocuments.id, node.entityId));
      document = doc ?? null;
    } else if (node.entityType === "canvas") {
      const [c] = await db.select().from(schema.canvases).where(eq(schema.canvases.id, node.entityId));
      canvas = c ?? null;
    }
    res.json({
      data: {
        node,
        document,
        canvas,
        breadcrumb: breadcrumbFor(rows, nodeId),
      },
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

wikiRouter.patch("/nodes/:nodeId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const nodeId = parseRouteId(req, "nodeId");
    const node = await requireNode(projectId, nodeId);
    if (!node) {
      sendError(res, 404, "not_found", "Node not found");
      return;
    }
    const parsed = nodePatch.parse(req.body);
    const [row] = await db
      .update(schema.wikiNodes)
      .set({
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.pinned !== undefined ? { pinned: parsed.pinned } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.wikiNodes.id, nodeId))
      .returning();

    if (parsed.title !== undefined && node.entityType === "document") {
      await db
        .update(schema.projectDocuments)
        .set({ title: parsed.title, updatedAt: new Date() })
        .where(eq(schema.projectDocuments.id, node.entityId));
    }
    if (parsed.title !== undefined && node.entityType === "canvas") {
      await db
        .update(schema.canvases)
        .set({ title: parsed.title, updatedAt: new Date() })
        .where(eq(schema.canvases.id, node.entityId));
    }
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

wikiRouter.patch("/nodes/:nodeId/move", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const nodeId = parseRouteId(req, "nodeId");
    const node = await requireNode(projectId, nodeId);
    if (!node) {
      sendError(res, 404, "not_found", "Node not found");
      return;
    }
    const parsed = moveBody.parse(req.body);
    const rows = await listWikiNodes(db, projectId);
    if (wouldCreateCycle(rows, nodeId, parsed.parentId)) {
      sendError(res, 400, "invalid_parent", "Cannot move a page under itself or its descendant");
      return;
    }
    if (parsed.parentId != null && !(await requireNode(projectId, parsed.parentId))) {
      sendError(res, 404, "not_found", "Parent node not found");
      return;
    }
    if (!parsed.orderedSiblingIds.includes(nodeId)) {
      sendError(res, 400, "invalid_reorder", "orderedSiblingIds must include the moved node");
      return;
    }

    for (const id of parsed.orderedSiblingIds) {
      const row = rows.find((r) => r.id === id);
      if (!row || row.projectId !== projectId) {
        sendError(res, 400, "invalid_item", `Node ${id} is not in this wiki`);
        return;
      }
    }

    await db
      .update(schema.wikiNodes)
      .set({ parentId: parsed.parentId, updatedAt: new Date() })
      .where(eq(schema.wikiNodes.id, nodeId));

    for (let i = 0; i < parsed.orderedSiblingIds.length; i++) {
      const id = parsed.orderedSiblingIds[i];
      if (id === undefined) continue;
      await db
        .update(schema.wikiNodes)
        .set({
          parentId: parsed.parentId,
          sortOrder: i,
          updatedAt: new Date(),
        })
        .where(eq(schema.wikiNodes.id, id));
    }

    // Re-pack old parent's remaining children if parent changed
    if (node.parentId !== parsed.parentId) {
      const oldSiblings =
        node.parentId == null
          ? await db
              .select()
              .from(schema.wikiNodes)
              .where(
                and(eq(schema.wikiNodes.projectId, projectId), isNull(schema.wikiNodes.parentId)),
              )
              .orderBy(asc(schema.wikiNodes.sortOrder), asc(schema.wikiNodes.id))
          : await db
              .select()
              .from(schema.wikiNodes)
              .where(
                and(
                  eq(schema.wikiNodes.projectId, projectId),
                  eq(schema.wikiNodes.parentId, node.parentId),
                ),
              )
              .orderBy(asc(schema.wikiNodes.sortOrder), asc(schema.wikiNodes.id));
      for (let i = 0; i < oldSiblings.length; i++) {
        const s = oldSiblings[i]!;
        if (s.sortOrder !== i) {
          await db
            .update(schema.wikiNodes)
            .set({ sortOrder: i, updatedAt: new Date() })
            .where(eq(schema.wikiNodes.id, s.id));
        }
      }
    }

    const fresh = await listWikiNodes(db, projectId);
    res.json({ data: { nodes: fresh, tree: buildWikiTree(fresh) } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

wikiRouter.delete("/nodes/:nodeId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const nodeId = parseRouteId(req, "nodeId");
    const node = await requireNode(projectId, nodeId);
    if (!node) {
      sendError(res, 404, "not_found", "Node not found");
      return;
    }
    // Children cascade via FK on parent_id
    await db.delete(schema.wikiNodes).where(eq(schema.wikiNodes.id, nodeId));
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});
