import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { parseRouteId } from "../../lib/routeParams.js";
import { requireAdministrator } from "../../middleware/requireAdministrator.js";
import {
  PROJECT_USER_ROLES,
  addProjectUser,
  listProjectUsers,
  removeProjectUser,
} from "../../services/projectUsers.js";

const addBody = z.object({
  userId: z.number().int().positive(),
  role: z.enum(PROJECT_USER_ROLES),
});

/** Admin-only project role lists (T0127). Mounted under /projects/:projectId/users. */
export const projectUsersRouter = Router({ mergeParams: true });

projectUsersRouter.use(requireAdministrator);

projectUsersRouter.get("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    res.json({ data: await listProjectUsers(db, projectId) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectUsersRouter.post("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const parsed = addBody.parse(req.body);
    const entry = await addProjectUser(db, projectId, parsed.userId, parsed.role);
    res.status(201).json({ data: entry });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectUsersRouter.delete("/:userId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const userId = z.coerce.number().int().positive().parse(req.params.userId);
    const removed = await removeProjectUser(db, projectId, userId);
    if (!removed) {
      sendError(res, 404, "not_found", "User is not on any role list for this project");
      return;
    }
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});
