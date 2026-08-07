import { Router } from "express";
import { assistantRouter } from "./assistant.js";
import { backupsRouter } from "./backups.js";
import { ideasRouter } from "./ideas.js";
import { importExportRouter } from "./importExport.js";
import { projectsRouter } from "./projects.js";
import { searchRouter } from "./search.js";
import { standaloneTasksRouter } from "./standaloneTasks.js";
import { taggingsRouter } from "./taggings.js";
import { tagsRouter } from "./tags.js";
import { todoListsRouter } from "./todoLists.js";
import { uploadsRouter } from "./uploads.js";
import { sendError } from "../../lib/httpError.js";

export const v1Router = Router();

v1Router.use("/ideas", ideasRouter);
v1Router.use("/projects", projectsRouter);
v1Router.use("/tasks", standaloneTasksRouter);
v1Router.use("/tags", tagsRouter);
v1Router.use("/taggings", taggingsRouter);
v1Router.use("/search", searchRouter);
v1Router.use("/todo-lists", todoListsRouter);
v1Router.use("/backups", backupsRouter);
v1Router.use("/assistant", assistantRouter);
v1Router.use(importExportRouter);
v1Router.use(uploadsRouter);

v1Router.use((_req, res) => {
  sendError(res, 404, "not_found", "No such API route");
});
