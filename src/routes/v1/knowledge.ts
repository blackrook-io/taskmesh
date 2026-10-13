import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { ENTITY_TYPES, type EntityType } from "../../lib/entityType.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { searchRateLimit } from "../../middleware/rateLimits.js";
import { searchKnowledge } from "../../services/knowledge/search.js";
import { userHasAdministrator } from "../../services/roles.js";
import { getCurrentUserId } from "../../services/users.js";

export const knowledgeRouter = Router();

const bodySchema = z.object({
  q: z.string().trim().min(1).max(500),
  projectId: z.number().int().positive().optional(),
  entityTypes: z.array(z.enum(ENTITY_TYPES)).max(ENTITY_TYPES.length).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

knowledgeRouter.post("/search", searchRateLimit, async (req, res) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "validation_error", "Provide q (1–500 characters)");
      return;
    }
    const actorId = await getCurrentUserId(db);
    const isAdmin = await userHasAdministrator(db, actorId);
    const hits = await searchKnowledge({
      actorId,
      isAdmin,
      q: parsed.data.q,
      projectId: parsed.data.projectId,
      entityTypes: parsed.data.entityTypes as EntityType[] | undefined,
      limit: parsed.data.limit ?? 8,
    });
    res.json({
      data: {
        hits: hits.map((hit) => ({
          entityType: hit.entityType,
          entityId: hit.entityId,
          projectId: hit.projectId,
          content: hit.content,
          heading: hit.heading,
          locator: hit.locator,
          startOffset: hit.startOffset,
          endOffset: hit.endOffset,
          score: hit.score,
        })),
      },
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});
