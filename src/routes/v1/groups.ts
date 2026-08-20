import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { hasDefinedKeys } from "../../lib/immutableFields.js";
import { isEmptyTaskGroupFilter, parseTaskGroupFilter } from "../../lib/taskGroupFilter.js";
import { parseRouteId } from "../../lib/routeParams.js";
import {
  applyTaskGroupAutoTags,
  assertAutoTagId,
} from "../../services/taskGroupAutoTag.js";

const groupBody = z.object({
  name: z.string().min(1).max(200),
  sortOrder: z.number().int().optional(),
  color: z.string().max(64).optional().nullable(),
  filter: z.unknown().optional().nullable(),
  showInNav: z.boolean().optional(),
  autoTagId: z.number().int().positive().nullable().optional(),
});

const groupPatch = z.object({
  name: z.string().min(1).max(200).optional(),
  sortOrder: z.number().int().optional(),
  color: z.string().max(64).optional().nullable(),
  filter: z.unknown().optional().nullable(),
  showInNav: z.boolean().optional(),
  autoTagId: z.number().int().positive().nullable().optional(),
});

const reorderBody = z.object({
  orderedGroupIds: z.array(z.number().int().positive()).min(1),
});

export const groupsRouter = Router({ mergeParams: true });

async function requireProject(projectId: number) {
  const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  return proj ?? null;
}

function resolveFilter(raw: unknown): ReturnType<typeof parseTaskGroupFilter> | undefined {
  if (raw === undefined) return undefined;
  return parseTaskGroupFilter(raw);
}

groupsRouter.post("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    if (!(await requireProject(projectId))) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const parsed = groupBody.parse(req.body);
    const filterParsed = resolveFilter(parsed.filter);
    if (filterParsed === "invalid") {
      sendError(res, 400, "invalid_filter", "Invalid group filter");
      return;
    }
    const storedFilter = filterParsed === undefined ? null : filterParsed;
    const autoTagOk = await assertAutoTagId(db, parsed.autoTagId);
    if (!autoTagOk.ok) {
      sendError(res, 400, "invalid_auto_tag", autoTagOk.message);
      return;
    }
    const existing = await db
      .select({ m: schema.taskGroups.sortOrder })
      .from(schema.taskGroups)
      .where(eq(schema.taskGroups.projectId, projectId));
    const nextSort =
      parsed.sortOrder ?? (existing.length ? Math.max(...existing.map((r) => r.m)) + 1 : 0);
    const [row] = await db
      .insert(schema.taskGroups)
      .values({
        projectId,
        name: parsed.name,
        sortOrder: nextSort,
        color: parsed.color ?? null,
        filter: storedFilter,
        showInNav: isEmptyTaskGroupFilter(storedFilter) ? false : (parsed.showInNav ?? false),
        autoTagId: parsed.autoTagId === undefined ? null : parsed.autoTagId,
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create group");
      return;
    }
    await applyTaskGroupAutoTags(db, { projectId });
    res.status(201).json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

groupsRouter.patch("/reorder", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    if (!(await requireProject(projectId))) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const { orderedGroupIds } = reorderBody.parse(req.body);
    const existing = await db
      .select({ id: schema.taskGroups.id })
      .from(schema.taskGroups)
      .where(eq(schema.taskGroups.projectId, projectId));
    const allowed = new Set(existing.map((e) => e.id));
    if (orderedGroupIds.length !== allowed.size) {
      sendError(res, 400, "invalid_reorder", "orderedGroupIds must list every group exactly once");
      return;
    }
    const seen = new Set<number>();
    for (const id of orderedGroupIds) {
      if (!allowed.has(id) || seen.has(id)) {
        sendError(res, 400, "invalid_reorder", "Invalid group id list");
        return;
      }
      seen.add(id);
    }
    for (let i = 0; i < orderedGroupIds.length; i++) {
      const id = orderedGroupIds[i];
      if (id === undefined) continue;
      await db
        .update(schema.taskGroups)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(schema.taskGroups.id, id));
    }
    const rows = await db
      .select()
      .from(schema.taskGroups)
      .where(eq(schema.taskGroups.projectId, projectId))
      .orderBy(asc(schema.taskGroups.sortOrder));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

groupsRouter.patch("/:groupId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const groupId = parseRouteId(req, "groupId");
    const parsed = groupPatch.parse(req.body);
    if (!hasDefinedKeys(parsed, ["name", "sortOrder", "color", "filter", "showInNav", "autoTagId"])) {
      sendError(res, 400, "empty_patch", "Provide name, sortOrder, color, filter, showInNav, and/or autoTagId");
      return;
    }
    const autoTagOk = await assertAutoTagId(db, parsed.autoTagId);
    if (!autoTagOk.ok) {
      sendError(res, 400, "invalid_auto_tag", autoTagOk.message);
      return;
    }
    const [existing] = await db
      .select()
      .from(schema.taskGroups)
      .where(eq(schema.taskGroups.id, groupId));
    if (!existing || existing.projectId !== projectId) {
      sendError(res, 404, "not_found", "Group not found");
      return;
    }
    let nextFilter: { clauses: { field: string; operator: string; value: string }[]; joins: string[] } | null | undefined;
    if (parsed.filter !== undefined) {
      const parsedFilter = parseTaskGroupFilter(parsed.filter);
      if (parsedFilter === "invalid") {
        sendError(res, 400, "invalid_filter", "Invalid group filter");
        return;
      }
      nextFilter = parsedFilter;
    }
    const resolvedFilter = nextFilter !== undefined ? nextFilter : existing.filter;
    const navOff = isEmptyTaskGroupFilter(resolvedFilter);
    const [row] = await db
      .update(schema.taskGroups)
      .set({
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
        ...(parsed.color !== undefined ? { color: parsed.color } : {}),
        ...(nextFilter !== undefined ? { filter: nextFilter } : {}),
        ...(navOff
          ? { showInNav: false }
          : parsed.showInNav !== undefined
            ? { showInNav: parsed.showInNav }
            : {}),
        ...(parsed.autoTagId !== undefined ? { autoTagId: parsed.autoTagId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.taskGroups.id, groupId))
      .returning();
    await applyTaskGroupAutoTags(db, { projectId });
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

groupsRouter.delete("/:groupId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const groupId = parseRouteId(req, "groupId");
    const [existing] = await db
      .select()
      .from(schema.taskGroups)
      .where(eq(schema.taskGroups.id, groupId));
    if (!existing || existing.projectId !== projectId) {
      sendError(res, 404, "not_found", "Group not found");
      return;
    }
    await db.delete(schema.taskGroups).where(eq(schema.taskGroups.id, groupId));
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});
