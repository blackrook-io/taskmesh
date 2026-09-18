import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { parseRouteId } from "../../lib/routeParams.js";
import { assertCanAccessProject } from "../../services/ownership.js";
import {
  PROJECT_USER_ROLES,
  addProjectGroup,
  addProjectUser,
  countUserProjectAssignments,
  listProjectDirectoryGroups,
  listProjectDirectoryUsers,
  listProjectUsers,
  removeProjectGroup,
  removeProjectUser,
} from "../../services/projectUsers.js";
import { getCurrentUserId } from "../../services/users.js";

const addBody = z
  .object({
    userId: z.number().int().positive().optional(),
    groupId: z.number().int().positive().optional(),
    role: z.enum(PROJECT_USER_ROLES),
  })
  .strict()
  .refine((b) => (b.userId != null) !== (b.groupId != null), {
    message: "Provide exactly one of userId or groupId",
  });

const removeBody = z
  .object({
    disposition: z.enum(["blank", "reassign"]).optional(),
    reassignToUserId: z.number().int().positive().optional(),
  })
  .optional();

/** Project Settings Users API — Admin or Manager (settings). Mounted under /projects/:projectId/users. */
export const projectUsersRouter = Router({ mergeParams: true });

async function ensureSettingsAccess(req: Parameters<typeof parseRouteId>[0], res: Parameters<typeof sendError>[0]): Promise<number | null> {
  try {
    const projectId = parseRouteId(req, "projectId");
    const actorId = await getCurrentUserId(db);
    await assertCanAccessProject(db, actorId, projectId, "settings");
    return projectId;
  } catch (err) {
    handleRouteError(res, err);
    return null;
  }
}

projectUsersRouter.get("/", async (req, res) => {
  try {
    const projectId = await ensureSettingsAccess(req, res);
    if (projectId == null) return;
    res.json({ data: await listProjectUsers(db, projectId) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectUsersRouter.get("/directory", async (req, res) => {
  try {
    const projectId = await ensureSettingsAccess(req, res);
    if (projectId == null) return;
    const [users, groups] = await Promise.all([
      listProjectDirectoryUsers(db, projectId),
      listProjectDirectoryGroups(db, projectId),
    ]);
    res.json({ data: { users, groups } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectUsersRouter.get("/:userId/assignments", async (req, res) => {
  try {
    const projectId = await ensureSettingsAccess(req, res);
    if (projectId == null) return;
    const userId = z.coerce.number().int().positive().parse(req.params.userId);
    res.json({ data: await countUserProjectAssignments(db, projectId, userId) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectUsersRouter.post("/", async (req, res) => {
  try {
    const projectId = await ensureSettingsAccess(req, res);
    if (projectId == null) return;
    const parsed = addBody.parse(req.body);
    if (parsed.groupId != null) {
      const entry = await addProjectGroup(db, projectId, parsed.groupId, parsed.role);
      res.status(201).json({ data: entry });
      return;
    }
    const entry = await addProjectUser(db, projectId, parsed.userId!, parsed.role);
    res.status(201).json({ data: entry });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectUsersRouter.delete("/groups/:groupId", async (req, res) => {
  try {
    const projectId = await ensureSettingsAccess(req, res);
    if (projectId == null) return;
    const groupId = z.coerce.number().int().positive().parse(req.params.groupId);
    const removed = await removeProjectGroup(db, projectId, groupId);
    if (!removed) {
      sendError(res, 404, "not_found", "Group is not on any role list for this project");
      return;
    }
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectUsersRouter.delete("/:userId", async (req, res) => {
  try {
    const projectId = await ensureSettingsAccess(req, res);
    if (projectId == null) return;
    const userId = z.coerce.number().int().positive().parse(req.params.userId);
    const parsed = removeBody.parse(req.body ?? {});
    let disposition: Parameters<typeof removeProjectUser>[3] = null;
    if (parsed?.disposition === "blank") {
      disposition = { disposition: "blank" };
    } else if (parsed?.disposition === "reassign") {
      if (parsed.reassignToUserId == null) {
        sendError(res, 400, "validation_error", "reassignToUserId is required when disposition is reassign");
        return;
      }
      disposition = {
        disposition: "reassign",
        reassignToUserId: parsed.reassignToUserId,
      };
    }
    const removed = await removeProjectUser(db, projectId, userId, disposition);
    if (!removed) {
      sendError(res, 404, "not_found", "User is not on any role list for this project");
      return;
    }
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});
