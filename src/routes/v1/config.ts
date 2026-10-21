import { Router } from "express";
import { db } from "../../db/client.js";
import { handleRouteError } from "../../lib/httpError.js";
import { isEmailSignupAvailable } from "../../services/mail/settings.js";
import { getPublicSystemConfig } from "../../services/systemProperties.js";

export const configRouter = Router();

configRouter.get("/", async (_req, res) => {
  try {
    const [config, emailSignup] = await Promise.all([
      getPublicSystemConfig(db),
      isEmailSignupAvailable(db),
    ]);
    res.json({ data: { ...config, emailSignup } });
  } catch (err) {
    handleRouteError(res, err);
  }
});
