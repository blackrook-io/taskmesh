import { and, asc, eq, ilike, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";

const idParam = z.coerce.number().int().positive();

const tagBody = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.string().trim().max(32).optional().nullable(),
});

const tagPatch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  color: z.string().trim().max(32).optional().nullable(),
});

const mergeBody = z.object({
  sourceTagId: z.number().int().positive(),
  targetTagId: z.number().int().positive(),
});

const tagSelect = {
  id: schema.tags.id,
  name: schema.tags.name,
  color: schema.tags.color,
  createdAt: schema.tags.createdAt,
  usageCount: sql<number>`coalesce(count(${schema.taggings.id}), 0)::int`.as(
    "usage_count",
  ),
};

async function loadTagWithUsage(id: number) {
  const [row] = await db
    .select(tagSelect)
    .from(schema.tags)
    .leftJoin(schema.taggings, eq(schema.taggings.tagId, schema.tags.id))
    .where(eq(schema.tags.id, id))
    .groupBy(schema.tags.id);
  return row ?? null;
}

export const tagsRouter = Router();

/** List all tags, or suggest by name when `q` has at least 3 characters. */
tagsRouter.get("/", async (req, res) => {
  try {
    const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (qRaw.length > 0 && qRaw.length < 3) {
      sendError(res, 400, "validation_error", "Query q must be at least 3 characters");
      return;
    }

    if (qRaw.length >= 3) {
      const rows = await db
        .select(tagSelect)
        .from(schema.tags)
        .leftJoin(schema.taggings, eq(schema.taggings.tagId, schema.tags.id))
        .where(ilike(schema.tags.name, `%${qRaw}%`))
        .groupBy(schema.tags.id)
        .orderBy(asc(schema.tags.name))
        .limit(25);
      res.json({ data: rows });
      return;
    }

    const rows = await db
      .select(tagSelect)
      .from(schema.tags)
      .leftJoin(schema.taggings, eq(schema.taggings.tagId, schema.tags.id))
      .groupBy(schema.tags.id)
      .orderBy(asc(schema.tags.name));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

tagsRouter.post("/", async (req, res) => {
  try {
    const parsed = tagBody.parse(req.body);
    const [existing] = await db
      .select()
      .from(schema.tags)
      .where(eq(schema.tags.name, parsed.name));
    if (existing) {
      sendError(res, 409, "conflict", "A tag with that name already exists");
      return;
    }
    const [row] = await db
      .insert(schema.tags)
      .values({
        name: parsed.name,
        color: parsed.color ?? null,
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create tag");
      return;
    }
    res.status(201).json({ data: { ...row, usageCount: 0 } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

/** Merge source taggings into target, then delete source. */
tagsRouter.post("/merge", async (req, res) => {
  try {
    const parsed = mergeBody.parse(req.body);
    if (parsed.sourceTagId === parsed.targetTagId) {
      sendError(res, 400, "validation_error", "Source and target tags must differ");
      return;
    }

    const merged = await db.transaction(async (tx) => {
      const [source] = await tx
        .select()
        .from(schema.tags)
        .where(eq(schema.tags.id, parsed.sourceTagId));
      const [target] = await tx
        .select()
        .from(schema.tags)
        .where(eq(schema.tags.id, parsed.targetTagId));
      if (!source || !target) {
        return null;
      }

      const sourceTaggings = await tx
        .select()
        .from(schema.taggings)
        .where(eq(schema.taggings.tagId, parsed.sourceTagId));

      for (const tagging of sourceTaggings) {
        const [dup] = await tx
          .select({ id: schema.taggings.id })
          .from(schema.taggings)
          .where(
            and(
              eq(schema.taggings.tagId, parsed.targetTagId),
              eq(schema.taggings.entityType, tagging.entityType),
              eq(schema.taggings.entityId, tagging.entityId),
            ),
          )
          .limit(1);
        if (!dup) {
          await tx.insert(schema.taggings).values({
            tagId: parsed.targetTagId,
            entityType: tagging.entityType,
            entityId: tagging.entityId,
          });
        }
      }

      await tx.delete(schema.tags).where(eq(schema.tags.id, parsed.sourceTagId));
      return parsed.targetTagId;
    });

    if (merged == null) {
      sendError(res, 404, "not_found", "Source or target tag not found");
      return;
    }

    const row = await loadTagWithUsage(merged);
    if (!row) {
      sendError(res, 404, "not_found", "Target tag not found after merge");
      return;
    }
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

tagsRouter.get("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const row = await loadTagWithUsage(id);
    if (!row) {
      sendError(res, 404, "not_found", "Tag not found");
      return;
    }
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

tagsRouter.patch("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const parsed = tagPatch.parse(req.body);
    if (parsed.name === undefined && parsed.color === undefined) {
      sendError(res, 400, "validation_error", "No fields to update");
      return;
    }
    const [existing] = await db.select().from(schema.tags).where(eq(schema.tags.id, id));
    if (!existing) {
      sendError(res, 404, "not_found", "Tag not found");
      return;
    }
    if (parsed.name !== undefined && parsed.name !== existing.name) {
      const [dup] = await db
        .select()
        .from(schema.tags)
        .where(eq(schema.tags.name, parsed.name));
      if (dup) {
        sendError(res, 409, "conflict", "A tag with that name already exists");
        return;
      }
    }
    await db
      .update(schema.tags)
      .set({
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.color !== undefined ? { color: parsed.color } : {}),
      })
      .where(eq(schema.tags.id, id));
    const row = await loadTagWithUsage(id);
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

tagsRouter.delete("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const deleted = await db
      .delete(schema.tags)
      .where(eq(schema.tags.id, id))
      .returning({ id: schema.tags.id });
    if (deleted.length === 0) {
      sendError(res, 404, "not_found", "Tag not found");
      return;
    }
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});
