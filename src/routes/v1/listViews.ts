import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { getCurrentUserId } from "../../services/users.js";
import {
  getListViewFields,
  getUserListViewPrefs,
  isListViewKey,
  putUserListViewPrefs,
  resetUserListViewPrefs,
} from "../../services/listViewPrefs.js";

export const listViewsRouter = Router();

const columnsBodySchema = z.object({
  columns: z.array(
    z.object({
      fieldKey: z.string().min(1),
      visible: z.boolean(),
    }),
  ),
});

listViewsRouter.get("/:listViewKey/fields", async (req, res) => {
  try {
    const key = req.params.listViewKey;
    if (!isListViewKey(key)) {
      sendError(res, 404, "not_found", "Unknown list view");
      return;
    }
    res.json({ data: await getListViewFields(db, key) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

listViewsRouter.get("/:listViewKey/prefs", async (req, res) => {
  try {
    const key = req.params.listViewKey;
    if (!isListViewKey(key)) {
      sendError(res, 404, "not_found", "Unknown list view");
      return;
    }
    const userId = await getCurrentUserId(db);
    res.json({ data: await getUserListViewPrefs(db, userId, key) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

listViewsRouter.put("/:listViewKey/prefs", async (req, res) => {
  try {
    const key = req.params.listViewKey;
    if (!isListViewKey(key)) {
      sendError(res, 404, "not_found", "Unknown list view");
      return;
    }
    const parsed = columnsBodySchema.parse(req.body);
    const userId = await getCurrentUserId(db);
    res.json({ data: await putUserListViewPrefs(db, userId, key, parsed.columns) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

listViewsRouter.delete("/:listViewKey/prefs", async (req, res) => {
  try {
    const key = req.params.listViewKey;
    if (!isListViewKey(key)) {
      sendError(res, 404, "not_found", "Unknown list view");
      return;
    }
    const userId = await getCurrentUserId(db);
    res.json({ data: await resetUserListViewPrefs(db, userId, key) });
  } catch (err) {
    handleRouteError(res, err);
  }
});
