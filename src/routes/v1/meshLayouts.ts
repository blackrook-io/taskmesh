import { Router } from "express";
import { db } from "../../db/client.js";
import { meshLayoutBodySchema, meshLayoutQuerySchema, parseMeshRoot } from "../../lib/meshLayoutRecord.js";
import { handleRouteError } from "../../lib/httpError.js";
import { deleteMeshLayout, getMeshLayout, putMeshLayout } from "../../services/meshLayouts.js";
import { getCurrentUserId } from "../../services/users.js";

export const meshLayoutsRouter = Router();

meshLayoutsRouter.get("/", async (req, res) => {
  try {
    const parsed = meshLayoutQuerySchema.parse({ root: req.query.root, view: req.query.view });
    const { rootType, rootId } = parseMeshRoot(parsed.root);
    const actorId = await getCurrentUserId(db);
    const data = await getMeshLayout(db, actorId, rootType, rootId, parsed.view);
    res.json({ data });
  } catch (err) {
    handleRouteError(res, err);
  }
});

meshLayoutsRouter.put("/", async (req, res) => {
  try {
    const parsed = meshLayoutQuerySchema.parse({ root: req.query.root, view: req.query.view });
    const body = meshLayoutBodySchema.parse(req.body);
    const { rootType, rootId } = parseMeshRoot(parsed.root);
    const actorId = await getCurrentUserId(db);
    const data = await putMeshLayout(db, actorId, rootType, rootId, parsed.view, body);
    res.json({ data });
  } catch (err) {
    handleRouteError(res, err);
  }
});

meshLayoutsRouter.delete("/", async (req, res) => {
  try {
    const parsed = meshLayoutQuerySchema.parse({ root: req.query.root, view: req.query.view });
    const { rootType, rootId } = parseMeshRoot(parsed.root);
    const actorId = await getCurrentUserId(db);
    await deleteMeshLayout(db, actorId, rootType, rootId, parsed.view);
    res.json({ data: null });
  } catch (err) {
    handleRouteError(res, err);
  }
});
