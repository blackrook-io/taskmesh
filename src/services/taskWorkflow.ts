import { inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import type { ProjectActorRole } from "./ownership.js";
import { resolveProjectActorRole } from "./ownership.js";
import { userHasAdministrator } from "./roles.js";

type Db = NodePgDatabase<typeof schema>;

export const TASK_TAG_CAP = 3;

const STATE_LABELS: Record<string, string> = {
  new: "Draft",
  blocked: "Blocked",
  ready: "Ready",
  in_progress: "In Progress",
  pending: "Pending",
  complete: "Complete",
  canceled: "Canceled",
  on_hold: "On Hold",
  deleted: "Deleted",
};

/** User-facing next states. Pending and Deleted are never included. */
const NEXT_STATES: Record<string, readonly string[]> = {
  new: ["ready", "canceled"],
  blocked: ["new", "canceled"],
  ready: ["in_progress", "canceled"],
  in_progress: ["on_hold", "complete"],
  on_hold: ["in_progress", "complete"],
  complete: ["ready"],
  canceled: ["ready"],
  pending: [],
  deleted: [],
};

const EDIT_KEYS = [
  "title",
  "description",
  "dueDate",
  "dueAt",
  "color",
  "phaseId",
  "parentId",
  "priority",
  "sortOrder",
  "assigneeId",
  "projectId",
] as const;

export class TaskWorkflowError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "TaskWorkflowError";
    this.status = status;
    this.code = code;
  }
}

export function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

export function isClosedTaskState(state: string): boolean {
  return state === "complete" || state === "canceled" || state === "deleted";
}

export function canReopenRole(role: ProjectActorRole | null): boolean {
  return role === "admin" || role === "owner" || role === "manager";
}

export function allowedNextStates(from: string, canReopen: boolean): string[] {
  const next = NEXT_STATES[from] ?? [];
  if ((from === "complete" || from === "canceled") && !canReopen) return [];
  return [...next];
}

function allowedPhrase(from: string, canReopen: boolean): string {
  const allowed = allowedNextStates(from, canReopen);
  if (allowed.length === 0) return "Allowed next states: none.";
  return `Allowed next states: ${allowed.map(stateLabel).join(", ")}.`;
}

function needsStateComment(from: string, to: string): boolean {
  if (to === "canceled") return true;
  return to === "ready" && (from === "complete" || from === "canceled");
}

export function assertTransition(input: {
  from: string;
  to: string | undefined;
  canReopen: boolean;
  stateComment?: string | null;
}): void {
  const to = input.to;
  if (to === undefined || to === input.from) return;
  const reopen = to === "ready" && (input.from === "complete" || input.from === "canceled");
  if (reopen && !input.canReopen) {
    throw new TaskWorkflowError(
      403,
      "reopen_forbidden",
      `Only a project Owner, Manager, or Administrator can reopen a ${stateLabel(input.from)} task. ${allowedPhrase(input.from, input.canReopen)}`,
    );
  }
  const allowed = allowedNextStates(input.from, input.canReopen);
  if (!allowed.includes(to)) {
    throw new TaskWorkflowError(
      400,
      "invalid_transition",
      `Cannot change a ${stateLabel(input.from)} task to ${stateLabel(to)}. ${allowedPhrase(input.from, input.canReopen)}`,
    );
  }
  if (needsStateComment(input.from, to) && !input.stateComment?.trim()) {
    const action = to === "canceled" ? "Canceling a task" : "Reopening a task";
    throw new TaskWorkflowError(400, "state_comment_required", `${action} requires a comment.`);
  }
}

export function assertEditable(
  state: string,
  patch: Partial<Record<(typeof EDIT_KEYS)[number], unknown>>,
): void {
  if (!isClosedTaskState(state)) return;
  const changing = EDIT_KEYS.some((key) => patch[key] !== undefined);
  if (!changing) return;
  throw new TaskWorkflowError(
    400,
    "task_closed",
    `${stateLabel(state)} tasks are read-only. You can add a comment.`,
  );
}

/** Create and import may only start at Draft. */
export function assertInitialState(state: string | undefined): void {
  const value = state ?? "new";
  if (value === "new") return;
  throw new TaskWorkflowError(400, "invalid_transition", "New tasks start as Draft.");
}

/** Spreadsheet `state` must be empty or `new`. */
export function assertImportedInitialState(raw: unknown): void {
  if (raw == null) return;
  const value = String(raw).trim();
  if (value === "") return;
  assertInitialState(value);
}

export function assertTagCap(currentCount: number, adding: number): void {
  if (adding <= 0) return;
  if (currentCount + adding <= TASK_TAG_CAP) return;
  throw new TaskWorkflowError(400, "tag_cap", `A task can have at most ${TASK_TAG_CAP} tags.`);
}

export function assertTaskTagAdd(state: string, currentCount: number): void {
  assertEditable(state, { title: "" });
  assertTagCap(currentCount, 1);
}

export function assertTaskTagRemove(state: string): void {
  assertEditable(state, { title: "" });
}

export function enforceTaskPatch(input: {
  fromState: string;
  canReopen: boolean;
  patch: {
    state?: string;
    stateComment?: string | null;
  } & Partial<Record<(typeof EDIT_KEYS)[number], unknown>>;
}): void {
  assertEditable(input.fromState, input.patch);
  assertTransition({
    from: input.fromState,
    to: input.patch.state,
    canReopen: input.canReopen,
    stateComment: input.patch.stateComment,
  });
}

/** True when this actor may reopen a Complete or Canceled task in that project. */
export async function actorCanReopen(
  db: Db,
  actorId: number,
  projectId: number | null,
): Promise<boolean> {
  const [row] = await attachAllowedNextStates(db, actorId, [{ state: "complete", projectId }]);
  return row?.allowedNextStates.includes("ready") ?? false;
}

export async function attachAllowedNextStates<T extends { state: string; projectId: number | null }>(
  db: Db,
  actorId: number,
  rows: T[],
): Promise<Array<T & { allowedNextStates: string[] }>> {
  if (rows.length === 0) return [];
  const isAdmin = await userHasAdministrator(db, actorId);
  const projectIds = [
    ...new Set(rows.map((row) => row.projectId).filter((id): id is number => id != null)),
  ];
  const canReopenByProject = new Map<number, boolean>();
  if (isAdmin) {
    for (const id of projectIds) canReopenByProject.set(id, true);
  } else if (projectIds.length > 0) {
    const projects = await db
      .select({ id: schema.projects.id, ownerId: schema.projects.ownerId })
      .from(schema.projects)
      .where(inArray(schema.projects.id, projectIds));
    for (const project of projects) {
      const role = await resolveProjectActorRole(db, actorId, project);
      canReopenByProject.set(project.id, canReopenRole(role));
    }
  }
  return rows.map((row) => {
    const canReopen =
      row.projectId == null ? isAdmin : (canReopenByProject.get(row.projectId) ?? false);
    return { ...row, allowedNextStates: allowedNextStates(row.state, canReopen) };
  });
}
