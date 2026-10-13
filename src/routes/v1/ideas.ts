import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { sendMutation, type MutationResult } from "../../lib/mutationResult.js";
import { optionalMarkdown, optionalPlainTitle, plainTitle } from "../../lib/markdownFields.js";
import { hasDefinedKeys } from "../../lib/immutableFields.js";
import { allocateIdeaNumber, allocateProjectNumber } from "../../services/entityNumbers.js";
import { syncMentionLinks } from "../../services/mentionLinks.js";
import {
  assertCanAccessOwned,
  ownerScope,
} from "../../services/ownership.js";
import { nextIdeaSortOrder } from "../../services/ideaSortOrder.js";
import { nextProjectSortOrder } from "../../services/projectSortOrder.js";
import { getAiProjectAccessCeiling } from "../../services/assistant/projectAiAccess.js";
import { userHasAdministrator } from "../../services/roles.js";
import { getCurrentUserId, attachAssignees, attachAssignee } from "../../services/users.js";
import { resolveIdeaAssigneeId } from "../../services/assignees.js";
import { forgetKnowledge, scheduleKnowledgeIndex } from "../../services/knowledge/schedule.js";

const ideaBody = z.object({
  title: plainTitle(500),
  body: optionalMarkdown(500_000),
  assigneeId: z.number().int().positive().nullable().optional(),
});

const ideaPatch = z.object({
  title: optionalPlainTitle(500),
  body: optionalMarkdown(500_000),
  assigneeId: z.number().int().positive().nullable().optional(),
});

const idParam = z.coerce.number().int().positive();

const reorderBody = z.object({
  orderedIds: z.array(z.number().int().positive()),
});

export const ideasRouter = Router();

ideasRouter.get("/", async (_req, res) => {
  try {
    const actorId = await getCurrentUserId(db);
    const isAdmin = await userHasAdministrator(db, actorId);
    const scope = ownerScope(schema.ideas.ownerId, actorId, isAdmin);
    const rows = await db
      .select()
      .from(schema.ideas)
      .where(scope)
      .orderBy(asc(schema.ideas.sortOrder), asc(schema.ideas.id));
    res.json({ data: await attachAssignees(db, rows) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

export async function createIdeaForActor(args: {
  body: unknown;
  actorId: number;
}): Promise<MutationResult> {
  const parsed = ideaBody.parse(args.body);
  const number = await allocateIdeaNumber(db);
  const assigneeId = resolveIdeaAssigneeId(parsed.assigneeId);
  const sortOrder = await nextIdeaSortOrder(db);
  const [row] = await db
    .insert(schema.ideas)
    .values({
      number,
      title: parsed.title,
      body: parsed.body ?? null,
      ownerId: args.actorId,
      assigneeId,
      sortOrder,
    })
    .returning();
  if (!row) {
    return { ok: false, status: 500, code: "insert_failed", message: "Could not create idea" };
  }
  await syncMentionLinks(db, {
    srcType: "idea",
    srcId: row.id,
    markdown: row.body,
    actorUserId: args.actorId,
  });
  await scheduleKnowledgeIndex("idea", row.id);
  return { ok: true, status: 201, data: await attachAssignee(db, row) };
}

ideasRouter.post("/", async (req, res) => {
  try {
    const actorId = await getCurrentUserId(db);
    sendMutation(res, await createIdeaForActor({ body: req.body, actorId }));
  } catch (err) {
    handleRouteError(res, err);
  }
});

ideasRouter.patch("/reorder", async (req, res) => {
  try {
    const { orderedIds } = reorderBody.parse(req.body);
    const actorId = await getCurrentUserId(db);
    const isAdmin = await userHasAdministrator(db, actorId);
    const scope = ownerScope(schema.ideas.ownerId, actorId, isAdmin);
    const existing = await db.select({ id: schema.ideas.id }).from(schema.ideas).where(scope);
    const allowed = new Set(existing.map((row) => row.id));
    if (orderedIds.length !== allowed.size || new Set(orderedIds).size !== orderedIds.length) {
      sendError(res, 400, "invalid_reorder", "orderedIds must list every idea exactly once");
      return;
    }
    for (const id of orderedIds) {
      if (!allowed.has(id)) {
        sendError(res, 400, "invalid_reorder", "orderedIds must list every idea exactly once");
        return;
      }
    }
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      if (id === undefined) continue;
      await db.update(schema.ideas).set({ sortOrder: i }).where(eq(schema.ideas.id, id));
    }
    const rows = await db
      .select()
      .from(schema.ideas)
      .where(scope)
      .orderBy(asc(schema.ideas.sortOrder), asc(schema.ideas.id));
    res.json({ data: await attachAssignees(db, rows) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

ideasRouter.get("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const actorId = await getCurrentUserId(db);
    const [row] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, id));
    if (!row) {
      sendError(res, 404, "not_found", "Idea not found");
      return;
    }
    await assertCanAccessOwned(db, actorId, row.ownerId);
    res.json({ data: await attachAssignee(db, row) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

export async function updateIdeaForActor(args: {
  id: number;
  body: unknown;
  actorId: number;
}): Promise<MutationResult> {
  const parsed = ideaPatch.parse(args.body);
  if (!hasDefinedKeys(parsed, ["title", "body", "assigneeId"])) {
    return { ok: false, status: 400, code: "empty_patch", message: "Provide title and/or body" };
  }
  const [existing] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, args.id));
  if (!existing) {
    return { ok: false, status: 404, code: "not_found", message: "Idea not found" };
  }
  await assertCanAccessOwned(db, args.actorId, existing.ownerId);
  const assigneeId =
    parsed.assigneeId !== undefined ? resolveIdeaAssigneeId(parsed.assigneeId) : undefined;
  const [row] = await db
    .update(schema.ideas)
    .set({
      ...(parsed.title !== undefined ? { title: parsed.title } : {}),
      ...(parsed.body !== undefined ? { body: parsed.body } : {}),
      ...(assigneeId !== undefined ? { assigneeId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.ideas.id, args.id))
    .returning();
  if (row && parsed.body !== undefined) {
    await syncMentionLinks(db, {
      srcType: "idea",
      srcId: row.id,
      markdown: row.body,
      actorUserId: args.actorId,
    });
  }
  if (row) await scheduleKnowledgeIndex("idea", row.id);
  return { ok: true, status: 200, data: row ? await attachAssignee(db, row) : row };
}

ideasRouter.patch("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const actorId = await getCurrentUserId(db);
    sendMutation(res, await updateIdeaForActor({ id, body: req.body, actorId }));
  } catch (err) {
    handleRouteError(res, err);
  }
});

ideasRouter.delete("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const actorId = await getCurrentUserId(db);
    const [existing] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, id));
    if (!existing) {
      sendError(res, 404, "not_found", "Idea not found");
      return;
    }
    await assertCanAccessOwned(db, actorId, existing.ownerId);
    await db.delete(schema.ideas).where(eq(schema.ideas.id, id));
    await forgetKnowledge("idea", id);
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});

ideasRouter.post("/:id/convert-to-project", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const actorId = await getCurrentUserId(db);
    const [idea] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, id));
    if (!idea) {
      sendError(res, 404, "not_found", "Idea not found");
      return;
    }
    await assertCanAccessOwned(db, actorId, idea.ownerId);

    const number = await allocateProjectNumber(db);
    const sortOrder = await nextProjectSortOrder(db);
    const aiAccess = await getAiProjectAccessCeiling(db);
    const [project] = await db
      .insert(schema.projects)
      .values({
        number,
        name: idea.title,
        description: idea.body,
        status: "idea",
        sourceIdeaId: idea.id,
        sortOrder,
        ownerId: actorId,
        aiAccess,
      })
      .returning();

    if (!project) {
      sendError(res, 500, "insert_failed", "Could not create project");
      return;
    }

    await scheduleKnowledgeIndex("project", project.id);
    res.status(201).json({ data: project });
  } catch (err) {
    handleRouteError(res, err);
  }
});
