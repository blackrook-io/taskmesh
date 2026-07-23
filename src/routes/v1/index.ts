import { Router } from "express";
import { ideasRouter } from "./ideas.js";
import { projectsRouter } from "./projects.js";
import { uploadsRouter } from "./uploads.js";
import { sendError } from "../../lib/httpError.js";

export const v1Router = Router();

v1Router.use("/ideas", ideasRouter);
v1Router.use("/projects", projectsRouter);
v1Router.use(uploadsRouter);

v1Router.use((_req, res) => {
  sendError(res, 404, "not_found", "No such API route");
});
