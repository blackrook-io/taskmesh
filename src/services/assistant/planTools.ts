import { z } from "zod";
import { OwnershipAccessError } from "../ownership.js";

const entityRef = z.object({
  entityType: z.enum(["task", "todo"]),
  entityId: z.coerce.number().int().positive(),
});

type BoardItem = {
  id: number;
  entityType: string;
  entityId: number;
  number: number | null | undefined;
  title: string;
  state: string;
  estimateHours: number | null;
  sortOrder: number;
};

type Board = {
  plan: {
    id: number;
    number: number;
    title: string;
    status: string;
    revision: number;
    projectId: number | null;
  };
  phases: Array<{
    id: number;
    name: string;
    sortOrder: number;
    items: BoardItem[];
  }>;
  edges: unknown;
};

export type PlanToolServices = {
  getBoard: (actorId: number, planId: number) => Promise<Board>;
  addItem: (
    actorId: number,
    planId: number,
    input: {
      entityType: "task" | "todo";
      entityId: number;
      phaseId: number;
      includeChildren?: boolean;
    },
  ) => Promise<Board>;
  reorder: (
    actorId: number,
    planId: number,
    revision: number,
    phases: Array<{ phaseId: number; itemIds: number[] }>,
  ) => Promise<Board>;
  setState: (
    actorId: number,
    planId: number,
    itemId: number,
    to: string,
    stateComment: string | null,
  ) => Promise<Board>;
  projection: (actorId: number, planId: number) => Promise<unknown>;
};

function slimBoard(board: Board) {
  return {
    plan: {
      id: board.plan.id,
      number: board.plan.number,
      title: board.plan.title,
      status: board.plan.status,
      revision: board.plan.revision,
      projectId: board.plan.projectId,
    },
    phases: board.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      sortOrder: phase.sortOrder,
      items: phase.items.map((item) => ({
        id: item.id,
        entityType: item.entityType,
        entityId: item.entityId,
        number: item.number ?? null,
        title: item.title,
        state: item.state,
        estimateHours: item.estimateHours,
        sortOrder: item.sortOrder,
      })),
    })),
    edges: board.edges,
  };
}

function invalid(err: unknown): string | null {
  if (err instanceof z.ZodError) return JSON.stringify({ error: "Invalid arguments" });
  if (err instanceof OwnershipAccessError) return JSON.stringify({ error: "Access denied" });
  return null;
}

export async function runPlanAssistantTool(
  name: string,
  args: unknown,
  actorId: number,
  services: PlanToolServices,
): Promise<string> {
  try {
    switch (name) {
      case "plan_get": {
        const parsed = z.object({ planId: z.coerce.number().int().positive() }).parse(args);
        return JSON.stringify(slimBoard(await services.getBoard(actorId, parsed.planId)));
      }
      case "plan_add_items": {
        const parsed = z
          .object({
            planId: z.coerce.number().int().positive(),
            phaseId: z.coerce.number().int().positive(),
            items: z.array(entityRef).min(1).max(50),
            includeChildren: z.boolean().optional(),
          })
          .parse(args);
        let board: Board | null = null;
        for (const item of parsed.items) {
          board = await services.addItem(actorId, parsed.planId, {
            entityType: item.entityType,
            entityId: item.entityId,
            phaseId: parsed.phaseId,
            includeChildren: parsed.includeChildren === true,
          });
        }
        return JSON.stringify({ ok: true, board: board ? slimBoard(board) : null });
      }
      case "plan_reorder": {
        const parsed = z
          .object({
            planId: z.coerce.number().int().positive(),
            revision: z.coerce.number().int().nonnegative(),
            phases: z
              .array(
                z.object({
                  phaseId: z.coerce.number().int().positive(),
                  itemIds: z.array(z.coerce.number().int().positive()),
                }),
              )
              .min(1),
          })
          .parse(args);
        const board = await services.reorder(actorId, parsed.planId, parsed.revision, parsed.phases);
        return JSON.stringify({ ok: true, board: slimBoard(board) });
      }
      case "plan_set_item_state": {
        const parsed = z
          .object({
            planId: z.coerce.number().int().positive(),
            itemId: z.coerce.number().int().positive(),
            to: z.string().min(1).max(40),
            stateComment: z.string().max(2000).optional().nullable(),
          })
          .parse(args);
        const board = await services.setState(
          actorId,
          parsed.planId,
          parsed.itemId,
          parsed.to,
          parsed.stateComment ?? null,
        );
        return JSON.stringify({ ok: true, board: slimBoard(board) });
      }
      case "plan_projection": {
        const parsed = z.object({ planId: z.coerce.number().int().positive() }).parse(args);
        return JSON.stringify(await services.projection(actorId, parsed.planId));
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    const message = invalid(err);
    if (message) return message;
    throw err;
  }
}
