import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { activitySourceFromRequest } from "../../lib/activityRequest.js";
import { dateOrderViolation, START_AFTER_TARGET_MESSAGE } from "../../lib/dateOrder.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { hasDefinedKeys } from "../../lib/immutableFields.js";
import { optionalMarkdown, optionalPlainTitle, plainTitle } from "../../lib/markdownFields.js";
import { startDateSchema } from "../../lib/taskFields.js";
import { workdayHoursSchema } from "../../lib/workdayHours.js";
import { getCurrentUserId } from "../../services/users.js";
import {
  addPlanItem,
  autoSortPlan,
  createPhase,
  createPlan,
  deletePhase,
  deletePlan,
  getPlan,
  getPlanBoard,
  getPlanProjection,
  listPlans,
  searchPlanCandidates,
  removePlanItem,
  reorderPhases,
  reorderPlan,
  setPlanItemState,
  updatePhase,
  updatePlan,
} from "../../services/planRecords.js";

export const plansRouter = Router();

const idParam = z.coerce.number().int().positive();
const planStatus = z.enum(["draft", "active", "complete", "archived"]);
const targetDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be YYYY-MM-DD")
  .nullable()
  .optional();
const capacitySchema = z.number().min(0).max(999.99).nullable().optional();
const phaseInput = z.object({
  name: plainTitle(200),
  color: z.string().max(64).nullable().optional(),
});

const createBody = z.object({
  title: plainTitle(500),
  description: optionalMarkdown(500_000),
  projectId: z.number().int().positive().nullable().optional(),
  status: planStatus.optional(),
  targetDate: targetDateSchema,
  startDate: startDateSchema,
  workdayHours: workdayHoursSchema.optional(),
  capacityHoursPerWeek: capacitySchema,
  phases: z.array(phaseInput).min(1).optional(),
});

const patchBody = z.object({
  title: optionalPlainTitle(500),
  description: optionalMarkdown(500_000),
  status: planStatus.optional(),
  targetDate: targetDateSchema,
  startDate: startDateSchema,
  workdayHours: workdayHoursSchema.optional(),
  capacityHoursPerWeek: capacitySchema,
});

const listQuery = z
  .object({
    projectId: z.coerce.number().int().positive().optional(),
    status: planStatus.optional(),
    entityType: z.enum(["task", "todo"]).optional(),
    entityId: z.coerce.number().int().positive().optional(),
  })
  .refine((query) => (query.entityType == null) === (query.entityId == null), {
    message: "entityType and entityId are required together",
  });

const candidatesQuery = z.object({
  q: z.string().max(200).optional(),
});

const reorderPhasesBody = z.object({
  revision: z.number().int().nonnegative(),
  orderedPhaseIds: z.array(z.number().int().positive()).min(1),
});

const addItemBody = z.object({
  entityType: z.enum(["task", "todo"]),
  entityId: z.number().int().positive(),
  phaseId: z.number().int().positive(),
  afterItemId: z.number().int().positive().nullable().optional(),
  includeChildren: z.boolean().optional(),
});

const reorderBody = z.object({
  revision: z.number().int().nonnegative(),
  phases: z
    .array(
      z.object({
        phaseId: z.number().int().positive(),
        itemIds: z.array(z.number().int().positive()),
      }),
    )
    .min(1),
});

const autoSortBody = z.object({
  revision: z.number().int().nonnegative(),
  apply: z.boolean(),
});

const stateBody = z.object({
  to: z.string().min(1),
  stateComment: z.string().max(5000).nullable().optional(),
});

const deletePhaseBody = z.object({
  moveItemsTo: z.number().int().positive().optional(),
  revision: z.number().int().nonnegative().optional(),
});

function datePairMessage(start: string | null | undefined, target: string | null | undefined): string | null {
  return dateOrderViolation(start, target, START_AFTER_TARGET_MESSAGE);
}

plansRouter.get("/", async (req, res) => {
  try {
    const parsed = listQuery.parse(req.query);
    const actorId = await getCurrentUserId(db);
    const data = await listPlans(db, actorId, parsed);
    res.json({ data });
  } catch (err) {
    handleRouteError(res, err);
  }
});

plansRouter.post("/", async (req, res) => {
  try {
    const parsed = createBody.parse(req.body);
    const inverted = datePairMessage(parsed.startDate, parsed.targetDate);
    if (inverted) {
      sendError(res, 400, "invalid_dates", inverted);
      return;
    }
    const actorId = await getCurrentUserId(db);
    const data = await createPlan(db, actorId, parsed);
    res.status(201).json({ data });
  } catch (err) {
    handleRouteError(res, err);
  }
});

plansRouter.get("/:planId", async (req, res) => {
  try {
    const planId = idParam.parse(req.params.planId);
    const actorId = await getCurrentUserId(db);
    res.json({ data: await getPlan(db, actorId, planId) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

plansRouter.patch("/:planId", async (req, res) => {
  try {
    const planId = idParam.parse(req.params.planId);
    const parsed = patchBody.parse(req.body);
    if (
      !hasDefinedKeys(parsed, [
        "title",
        "description",
        "status",
        "targetDate",
        "startDate",
        "workdayHours",
        "capacityHoursPerWeek",
      ])
    ) {
      sendError(res, 400, "empty_patch", "No updatable fields provided");
      return;
    }
    const actorId = await getCurrentUserId(db);
    res.json({ data: await updatePlan(db, actorId, planId, parsed) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

plansRouter.delete("/:planId", async (req, res) => {
  try {
    const planId = idParam.parse(req.params.planId);
    const actorId = await getCurrentUserId(db);
    await deletePlan(db, actorId, planId);
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});

plansRouter.get("/:planId/projection", async (req, res) => {
  try {
    const planId = idParam.parse(req.params.planId);
    const actorId = await getCurrentUserId(db);
    res.json({ data: await getPlanProjection(db, actorId, planId) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

plansRouter.get("/:planId/board", async (req, res) => {
  try {
    const planId = idParam.parse(req.params.planId);
    const actorId = await getCurrentUserId(db);
    res.json({ data: await getPlanBoard(db, actorId, planId) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

plansRouter.get("/:planId/candidates", async (req, res) => {
  try {
    const planId = idParam.parse(req.params.planId);
    const parsed = candidatesQuery.parse(req.query);
    const actorId = await getCurrentUserId(db);
    res.json({ data: await searchPlanCandidates(db, actorId, planId, parsed.q ?? "") });
  } catch (err) {
    handleRouteError(res, err);
  }
});

plansRouter.post("/:planId/phases", async (req, res) => {
  try {
    const planId = idParam.parse(req.params.planId);
    const parsed = phaseInput.parse(req.body);
    const actorId = await getCurrentUserId(db);
    const data = await createPhase(db, actorId, planId, parsed);
    res.status(201).json({ data });
  } catch (err) {
    handleRouteError(res, err);
  }
});

plansRouter.post("/:planId/phases/reorder", async (req, res) => {
  try {
    const planId = idParam.parse(req.params.planId);
    const parsed = reorderPhasesBody.parse(req.body);
    const actorId = await getCurrentUserId(db);
    res.json({
      data: await reorderPhases(db, actorId, planId, parsed.revision, parsed.orderedPhaseIds),
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

plansRouter.patch("/:planId/phases/:phaseId", async (req, res) => {
  try {
    const planId = idParam.parse(req.params.planId);
    const phaseId = idParam.parse(req.params.phaseId);
    const parsed = phaseInput.partial().parse(req.body);
    if (!hasDefinedKeys(parsed, ["name", "color"])) {
      sendError(res, 400, "empty_patch", "No updatable fields provided");
      return;
    }
    const actorId = await getCurrentUserId(db);
    res.json({ data: await updatePhase(db, actorId, planId, phaseId, parsed) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

plansRouter.delete("/:planId/phases/:phaseId", async (req, res) => {
  try {
    const planId = idParam.parse(req.params.planId);
    const phaseId = idParam.parse(req.params.phaseId);
    const parsed = deletePhaseBody.parse(req.body ?? {});
    const actorId = await getCurrentUserId(db);
    await deletePhase(
      db,
      actorId,
      planId,
      phaseId,
      parsed.moveItemsTo ?? null,
      parsed.revision ?? null,
    );
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});

plansRouter.post("/:planId/items", async (req, res) => {
  try {
    const planId = idParam.parse(req.params.planId);
    const parsed = addItemBody.parse(req.body);
    const actorId = await getCurrentUserId(db);
    const data = await addPlanItem(db, actorId, planId, parsed);
    res.status(201).json({ data });
  } catch (err) {
    handleRouteError(res, err);
  }
});

plansRouter.delete("/:planId/items/:itemId", async (req, res) => {
  try {
    const planId = idParam.parse(req.params.planId);
    const itemId = idParam.parse(req.params.itemId);
    const actorId = await getCurrentUserId(db);
    res.json({ data: await removePlanItem(db, actorId, planId, itemId) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

plansRouter.post("/:planId/items/:itemId/state", async (req, res) => {
  try {
    const planId = idParam.parse(req.params.planId);
    const itemId = idParam.parse(req.params.itemId);
    const parsed = stateBody.parse(req.body);
    const actorId = await getCurrentUserId(db);
    res.json({
      data: await setPlanItemState(
        db,
        actorId,
        planId,
        itemId,
        parsed.to,
        parsed.stateComment ?? null,
        activitySourceFromRequest(req),
      ),
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

plansRouter.post("/:planId/reorder", async (req, res) => {
  try {
    const planId = idParam.parse(req.params.planId);
    const parsed = reorderBody.parse(req.body);
    const actorId = await getCurrentUserId(db);
    res.json({ data: await reorderPlan(db, actorId, planId, parsed.revision, parsed.phases) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

plansRouter.post("/:planId/auto-sort", async (req, res) => {
  try {
    const planId = idParam.parse(req.params.planId);
    const parsed = autoSortBody.parse(req.body);
    const actorId = await getCurrentUserId(db);
    res.json({ data: await autoSortPlan(db, actorId, planId, parsed.revision, parsed.apply) });
  } catch (err) {
    handleRouteError(res, err);
  }
});
