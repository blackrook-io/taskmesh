import { Router } from "express";
import { getAppVersionMeta } from "../../lib/appVersion.js";
import { handleRouteError } from "../../lib/httpError.js";
import { requireAdministrator } from "../../middleware/requireAdministrator.js";
import { latestStableRelease, updateAvailable } from "../../services/githubRelease.js";

export const systemRouter = Router();

systemRouter.use(requireAdministrator);

systemRouter.get("/update", async (_req, res) => {
  const currentVersion = getAppVersionMeta().version;
  try {
    const latest = await latestStableRelease();
    const available = updateAvailable(currentVersion, latest);
    res.json({
      data: {
        currentVersion,
        latestVersion: latest?.version ?? null,
        updateAvailable: available,
        releaseUrl: available ? (latest?.htmlUrl ?? null) : null,
      },
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});
