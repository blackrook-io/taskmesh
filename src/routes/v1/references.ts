import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { entityTypeFromPrefix } from "../../lib/entityRef.js";
import { ENTITY_TYPES } from "../../lib/entityType.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import {
  searchEntityReferences,
  searchUserReferences,
} from "../../services/references.js";
import { userHasAdministrator } from "../../services/roles.js";
import { getCurrentUserId } from "../../services/users.js";

export const referencesRouter = Router();

const searchQuery = z.object({
  q: z.string().min(1).max(200),
  type: z.enum([...ENTITY_TYPES, "user"]).optional(),
});

referencesRouter.get("/search", async (req, res) => {
  try {
    const parsed = searchQuery.parse({
      q: req.query.q,
      type: req.query.type,
    });

    let entityType = parsed.type ?? null;
    let q = parsed.q.trim();

    // Allow `#T003` style tokens: first letter may be the type prefix.
    if (!entityType && /^[A-Za-z]/.test(q)) {
      const letter = q[0]!;
      const fromPrefix = entityTypeFromPrefix(letter);
      if (fromPrefix) {
        entityType = fromPrefix;
        q = q.slice(1);
      }
    }

    if (!entityType) {
      sendError(
        res,
        400,
        "validation_error",
        "Provide type=… or a query starting with a type prefix (T, I, P, …)",
      );
      return;
    }

    // A bare type prefix (e.g. `q=T`) leaves an empty remainder. That used to
    // match every row of that type; it must not enumerate the instance (T0143).
    // The SPA never sends this — `mdReferenceTrigger` suppresses the request
    // until at least one character follows the prefix.
    if (!q.length) {
      sendError(
        res,
        400,
        "validation_error",
        "Provide at least one character after the type prefix",
      );
      return;
    }

    const actorId = await getCurrentUserId(db);
    const actor = {
      userId: actorId,
      isAdministrator: await userHasAdministrator(db, actorId),
    };

    if (entityType === "user") {
      const data = await searchUserReferences(db, q);
      res.json({ data });
      return;
    }

    const data = await searchEntityReferences(db, entityType, q, actor);
    res.json({ data });
  } catch (err) {
    handleRouteError(res, err);
  }
});
