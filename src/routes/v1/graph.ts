import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { ENTITY_TYPES } from "../../lib/entityType.js";
import { parseGraphRelations } from "../../lib/graphWalk.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { getGraphNeighbourhood } from "../../services/graph.js";
import { assertCanAccessEntity, assertCanAccessOwned } from "../../services/ownership.js";
import { userHasAdministrator } from "../../services/roles.js";
import { getCurrentUserId } from "../../services/users.js";
import * as schema from "../../db/schema.js";
import { eq } from "drizzle-orm";

const rootTypes = [...ENTITY_TYPES, "tag"] as const;

const graphQuery = z.object({
  root: z.string().regex(/^(idea|project|task|todo|document|todo_list|board|canvas|wiki_node|image_board|tag):\d+$/),
  depth: z.coerce.number().int().optional(),
  rel: z.string().max(400).optional(),
  hideDone: z.enum(["true", "false", "1", "0"]).optional(),
});

function clampDepth(depth: number | undefined): number {
  if (depth == null) return 2;
  if (depth < 1) return 1;
  if (depth > 3) return 3;
  return depth;
}

export const graphRouter = Router();

graphRouter.get("/", async (req, res) => {
  try {
    const parsed = graphQuery.parse({
      root: req.query.root,
      depth: req.query.depth,
      rel: req.query.rel,
      hideDone: req.query.hideDone,
    });
    const [type, idRaw] = parsed.root.split(":");
    const rootType = z.enum(rootTypes).parse(type);
    const rootId = z.coerce.number().int().positive().parse(idRaw);
    const relations = parseGraphRelations(parsed.rel);
    if (!relations.ok) {
      sendError(res, 400, "validation_error", `Unknown relation: ${relations.unknown}`);
      return;
    }

    const actorId = await getCurrentUserId(db);
    if (rootType === "tag") {
      const [tag] = await db
        .select({ id: schema.tags.id, ownerId: schema.tags.ownerId })
        .from(schema.tags)
        .where(eq(schema.tags.id, rootId));
      if (!tag) {
        sendError(res, 404, "not_found", "Entity not found");
        return;
      }
      await assertCanAccessOwned(db, actorId, tag.ownerId);
    } else {
      await assertCanAccessEntity(db, actorId, rootType, rootId);
    }

    const data = await getGraphNeighbourhood(db, {
      userId: actorId,
      isAdministrator: await userHasAdministrator(db, actorId),
    }, {
      rootType,
      rootId,
      depth: clampDepth(parsed.depth),
      relations: relations.relations,
      hideDone: parsed.hideDone === "true" || parsed.hideDone === "1",
    });
    res.json({ data });
  } catch (err) {
    handleRouteError(res, err);
  }
});
