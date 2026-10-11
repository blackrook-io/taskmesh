import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { ENTITY_TYPES } from "../../lib/entityType.js";
import { LINK_RELATIONS } from "../../lib/entityLinkRules.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import {
  createManualLink,
  deleteManualLink,
  listEntityLinks,
} from "../../services/entityLinks.js";
import { assertCanAccessEntity } from "../../services/ownership.js";
import { userHasAdministrator } from "../../services/roles.js";
import { getCurrentUserId } from "../../services/users.js";

const idParam = z.coerce.number().int().positive();
const entityTypeSchema = z.enum(ENTITY_TYPES);
const relationSchema = z.enum(LINK_RELATIONS);

const listQuery = z.object({
  entityType: entityTypeSchema,
  entityId: idParam,
});

const createBody = z.object({
  srcType: entityTypeSchema,
  srcId: z.number().int().positive(),
  dstType: entityTypeSchema,
  dstId: z.number().int().positive(),
  relation: relationSchema.optional(),
});

export const linksRouter = Router();

linksRouter.get("/", async (req, res) => {
  try {
    const parsed = listQuery.parse({
      entityType: req.query.entityType,
      entityId: req.query.entityId,
    });
    const actorId = await getCurrentUserId(db);
    await assertCanAccessEntity(db, actorId, parsed.entityType, parsed.entityId);
    const actor = {
      userId: actorId,
      isAdministrator: await userHasAdministrator(db, actorId),
    };
    const data = await listEntityLinks(db, parsed.entityType, parsed.entityId, actor);
    res.json({ data });
  } catch (err) {
    handleRouteError(res, err);
  }
});

linksRouter.post("/", async (req, res) => {
  try {
    const parsed = createBody.parse(req.body);
    const actorId = await getCurrentUserId(db);
    await assertCanAccessEntity(db, actorId, parsed.srcType, parsed.srcId, "write");
    await assertCanAccessEntity(db, actorId, parsed.dstType, parsed.dstId);
    const actor = {
      userId: actorId,
      isAdministrator: await userHasAdministrator(db, actorId),
    };
    const result = await createManualLink(
      db,
      { ...parsed, createdById: actorId },
      actor,
    );
    res.status(result.created ? 201 : 200).json({ data: result.link });
  } catch (err) {
    handleRouteError(res, err);
  }
});

linksRouter.delete("/:id", async (req, res) => {
  try {
    const linkId = idParam.parse(req.params.id);
    const [row] = await db
      .select()
      .from(schema.entityLinks)
      .where(eq(schema.entityLinks.id, linkId));
    if (!row) {
      sendError(res, 404, "not_found", "Link not found.");
      return;
    }
    if (row.origin !== "manual") {
      sendError(res, 403, "link_not_manual", "Only manual links can be deleted here.");
      return;
    }
    const actorId = await getCurrentUserId(db);
    const srcType = entityTypeSchema.parse(row.srcType);
    const dstType = entityTypeSchema.parse(row.dstType);
    await assertCanAccessEntity(db, actorId, srcType, row.srcId, "write");
    await assertCanAccessEntity(db, actorId, dstType, row.dstId);
    await deleteManualLink(db, linkId);
    res.json({ data: { id: linkId } });
  } catch (err) {
    handleRouteError(res, err);
  }
});
