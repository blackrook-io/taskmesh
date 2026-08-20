import { and, asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { ENTITY_TYPES } from "../../lib/entityType.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import {
  entityExists,
  isTaggableEntityType,
} from "../../services/entities.js";
import { applyTaskGroupAutoTagsForTask } from "../../services/taskGroupAutoTag.js";

const idParam = z.coerce.number().int().positive();

const entityTypeSchema = z.enum(ENTITY_TYPES);

const attachBody = z
  .object({
    entityType: entityTypeSchema,
    entityId: z.number().int().positive(),
    tagId: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(100).optional(),
    color: z.string().trim().max(32).optional().nullable(),
  })
  .refine((v) => v.tagId != null || (v.name != null && v.name.length > 0), {
    message: "Provide tagId or name",
  });

export const taggingsRouter = Router();

/** List tags attached to an entity, or all taggings for an entity type when entityId is omitted. */
taggingsRouter.get("/", async (req, res) => {
  try {
    const entityType = entityTypeSchema.parse(req.query.entityType);
    const entityIdRaw = req.query.entityId;
    const entityId =
      entityIdRaw == null || entityIdRaw === "" ? undefined : idParam.parse(entityIdRaw);
    if (!isTaggableEntityType(entityType)) {
      sendError(res, 400, "validation_error", `Entity type ${entityType} does not support tags yet`);
      return;
    }

    const filters = [eq(schema.taggings.entityType, entityType)];
    if (entityId != null) {
      filters.push(eq(schema.taggings.entityId, entityId));
    }

    const rows = await db
      .select({
        entityId: schema.taggings.entityId,
        id: schema.tags.id,
        name: schema.tags.name,
        color: schema.tags.color,
        createdAt: schema.tags.createdAt,
      })
      .from(schema.taggings)
      .innerJoin(schema.tags, eq(schema.taggings.tagId, schema.tags.id))
      .where(and(...filters))
      .orderBy(asc(schema.taggings.entityId), asc(schema.tags.name));

    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

/** Attach an existing tag, or create-by-name then attach. */
taggingsRouter.post("/", async (req, res) => {
  try {
    const parsed = attachBody.parse(req.body);
    if (!isTaggableEntityType(parsed.entityType)) {
      sendError(
        res,
        400,
        "validation_error",
        `Entity type ${parsed.entityType} does not support tags yet`,
      );
      return;
    }

    const exists = await entityExists(db, parsed.entityType, parsed.entityId);
    if (!exists) {
      sendError(res, 404, "not_found", "Entity not found");
      return;
    }

    let tag: typeof schema.tags.$inferSelect | undefined;

    if (parsed.tagId != null) {
      const [found] = await db
        .select()
        .from(schema.tags)
        .where(eq(schema.tags.id, parsed.tagId));
      if (!found) {
        sendError(res, 404, "not_found", "Tag not found");
        return;
      }
      tag = found;
    } else {
      const name = parsed.name!.trim();
      const [existing] = await db
        .select()
        .from(schema.tags)
        .where(eq(schema.tags.name, name));
      if (existing) {
        tag = existing;
      } else {
        const [created] = await db
          .insert(schema.tags)
          .values({ name, color: parsed.color ?? null })
          .returning();
        tag = created;
      }
    }

    if (!tag) {
      sendError(res, 500, "insert_failed", "Could not resolve tag");
      return;
    }

    const [dup] = await db
      .select()
      .from(schema.taggings)
      .where(
        and(
          eq(schema.taggings.tagId, tag.id),
          eq(schema.taggings.entityType, parsed.entityType),
          eq(schema.taggings.entityId, parsed.entityId),
        ),
      );
    if (dup) {
      res.status(200).json({ data: tag });
      return;
    }

    await db.insert(schema.taggings).values({
      tagId: tag.id,
      entityType: parsed.entityType,
      entityId: parsed.entityId,
    });

    if (parsed.entityType === "task") {
      await applyTaskGroupAutoTagsForTask(db, parsed.entityId);
    }

    res.status(201).json({ data: tag });
  } catch (err) {
    handleRouteError(res, err);
  }
});

/** Detach a tag from an entity. */
taggingsRouter.delete("/", async (req, res) => {
  try {
    const body = z
      .object({
        tagId: z.number().int().positive(),
        entityType: entityTypeSchema,
        entityId: z.number().int().positive(),
      })
      .parse(req.body);

    const deleted = await db
      .delete(schema.taggings)
      .where(
        and(
          eq(schema.taggings.tagId, body.tagId),
          eq(schema.taggings.entityType, body.entityType),
          eq(schema.taggings.entityId, body.entityId),
        ),
      )
      .returning({ id: schema.taggings.id });

    if (deleted.length === 0) {
      sendError(res, 404, "not_found", "Tagging not found");
      return;
    }
    if (body.entityType === "task") {
      await applyTaskGroupAutoTagsForTask(db, body.entityId);
    }
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});
