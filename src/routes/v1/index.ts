import { Router } from "express";
import { adminRouter } from "./admin.js";
import { assistantRouter } from "./assistant.js";
import { backupsRouter } from "./backups.js";
import { configRouter } from "./config.js";
import { ideasRouter } from "./ideas.js";
import { imageBoardsRouter } from "./imageBoards.js";
import { importExportRouter } from "./importExport.js";
import { projectsRouter } from "./projects.js";
import { referencesRouter } from "./references.js";
import { searchRouter } from "./search.js";
import { standaloneTasksRouter } from "./standaloneTasks.js";
import { taskActivityRouter } from "./taskActivity.js";
import { taskDependenciesRouter } from "./taskDependencies.js";
import { taskDescriptionTemplatesRouter } from "./taskDescriptionTemplates.js";
import { taggingsRouter } from "./taggings.js";
import { tagsRouter } from "./tags.js";
import { todoListsRouter } from "./todoLists.js";
import { uploadsRouter } from "./uploads.js";
import { usersRouter } from "./users.js";
import { sendError } from "../../lib/httpError.js";
import { apiRequestLogger } from "../../middleware/apiRequestLogger.js";
import { rejectImmutableBody } from "../../middleware/rejectImmutableBody.js";

export const v1Router = Router();

v1Router.use(rejectImmutableBody);
v1Router.use(apiRequestLogger);

v1Router.use("/admin", adminRouter);
v1Router.use("/config", configRouter);
v1Router.use("/ideas", ideasRouter);
v1Router.use("/projects", projectsRouter);
v1Router.use("/task-description-templates", taskDescriptionTemplatesRouter);
v1Router.use("/tasks", taskDependenciesRouter);
v1Router.use("/tasks", taskActivityRouter);
v1Router.use("/tasks", standaloneTasksRouter);
v1Router.use("/users", usersRouter);
v1Router.use("/tags", tagsRouter);
v1Router.use("/taggings", taggingsRouter);
v1Router.use("/search", searchRouter);
v1Router.use("/references", referencesRouter);
v1Router.use("/todo-lists", todoListsRouter);
v1Router.use("/backups", backupsRouter);
v1Router.use("/assistant", assistantRouter);
v1Router.use("/image-boards", imageBoardsRouter);
v1Router.use(importExportRouter);
v1Router.use(uploadsRouter);

v1Router.use((_req, res) => {
  sendError(res, 404, "not_found", "No such API route");
});
