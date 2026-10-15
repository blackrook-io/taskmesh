import { and, asc, desc, eq, inArray, isNull, ne, or, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { db as AppDatabase } from "../db/client.js";
import * as schema from "../db/schema.js";
import type { ActivitySource } from "../lib/activityRequest.js";
import { dateOrderViolation, START_AFTER_TARGET_MESSAGE } from "../lib/dateOrder.js";
import { planCandidateMatches } from "../lib/planCandidates.js";
import { NotFoundError } from "../lib/notFound.js";
import { derivedStatePatchRejected } from "../lib/taskRollup.js";
import { resolveTodoProgressUpdate, resolveTodoCheckToggle } from "../lib/todoProgress.js";
import { allocatePlanNumber } from "./entityNumbers.js";
import {
  assertPlanRevision,
  computePlanRollup,
  insertPlanBlock,
  itemKey,
  orderViolationError,
  rejectedInsertViolations,
  planItemActions,
  previewFixOrder,
  validatePlanOrder,
  type PlanDependencyEdge,
  type PlanEntityType,
  type PlanItemRef,
  type PlanLayoutItem,
  type PlanRollupSlice,
} from "./plans.js";
import {
  assertCanAccessOwned,
  assertCanAccessProject,
  canAccessOwned,
  dualScopeListFilter,
  OwnershipAccessError,
  resolveProjectActorRole,
  roleSatisfiesAccess,
  type ProjectAccessLevel,
} from "./ownership.js";
import { userHasAdministrator } from "./roles.js";
import { actorCanReopen, enforceTaskPatch } from "./taskWorkflow.js";
import { formatBlockersMessage, openDependsOnBlockers } from "./taskDependencies.js";
import { resolvePersistedState, afterTaskHierarchyChange } from "./taskPending.js";
import { recordTaskChanges } from "./tasks.js";
import {
  promoteBlockedDependents,
  shouldBlockReadyDependents,
  shouldPromoteBlockedDependents,
  blockReadyDependents,
} from "./taskBlocked.js";
import { scheduleKnowledgeIndex } from "./knowledge/schedule.js";
import { applyTodoProgressResult } from "./todoProgress.js";
import { recomputeAncestorChain } from "./todoHierarchy.js";
import { attachAssignees } from "./users.js";

type Db = NodePgDatabase<typeof schema>;

type PlanRow = typeof schema.plans.$inferSelect;
type AccessLevel = ProjectAccessLevel | "structure";

export type PlanPhaseInput = { name: string; color?: string | null };

export type PlanWriteInput = {
  title?: string;
  description?: string | null;
  status?: "draft" | "active" | "complete" | "archived";
  targetDate?: string | null;
  startDate?: string | null;
  workdayHours?: number;
  capacityHoursPerWeek?: number | null;
};

const EMPTY_ROLLUP: PlanRollupSlice = {
  hoursTotal: 0,
  hoursDone: 0,
  progress: 0,
  progressMode: "count",
  itemCount: 0,
  itemsDone: 0,
  unestimatedCount: 0,
};

function fail(status: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { status, code });
}

function presentPlan(row: PlanRow) {
  return {
    id: row.id,
    number: row.number,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: row.status,
    targetDate: row.targetDate,
    startDate: row.startDate,
    workdayHours: Number(row.workdayHours),
    capacityHoursPerWeek:
      row.capacityHoursPerWeek == null ? null : Number(row.capacityHoursPerWeek),
    revision: row.revision,
    ownerId: row.ownerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function hoursOf(value: unknown): number | null {
  if (value == null) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

async function requirePlan(db: Db, actorId: number, planId: number, level: AccessLevel): Promise<PlanRow> {
  const [plan] = await db.select().from(schema.plans).where(eq(schema.plans.id, planId));
  if (!plan) throw new NotFoundError("Plan not found");
  if (plan.projectId == null) {
    if (!(await canAccessOwned(db, actorId, plan.ownerId))) {
      throw new NotFoundError("Plan not found");
    }
    return plan;
  }
  const [project] = await db
    .select({ id: schema.projects.id, ownerId: schema.projects.ownerId })
    .from(schema.projects)
    .where(eq(schema.projects.id, plan.projectId));
  if (!project) throw new NotFoundError("Plan not found");
  const role = await resolveProjectActorRole(db, actorId, project);
  if (role == null || !roleSatisfiesAccess(role, "read")) {
    throw new NotFoundError("Plan not found");
  }
  const needed: ProjectAccessLevel = level === "structure" ? "settings" : level;
  if (!roleSatisfiesAccess(role, needed)) throw new OwnershipAccessError();
  return plan;
}

async function actorCanWritePlan(db: Db, actorId: number, plan: PlanRow): Promise<boolean> {
  if (plan.projectId == null) return canAccessOwned(db, actorId, plan.ownerId);
  try {
    await assertCanAccessProject(db, actorId, plan.projectId, "write");
    return true;
  } catch (err) {
    if (err instanceof OwnershipAccessError || err instanceof NotFoundError) return false;
    throw err;
  }
}

async function actorCanStructurePlan(db: Db, actorId: number, plan: PlanRow): Promise<boolean> {
  if (plan.projectId == null) return canAccessOwned(db, actorId, plan.ownerId);
  try {
    await assertCanAccessProject(db, actorId, plan.projectId, "settings");
    return true;
  } catch (err) {
    if (err instanceof OwnershipAccessError || err instanceof NotFoundError) return false;
    throw err;
  }
}

function assertDates(start: string | null, target: string | null): void {
  const message = dateOrderViolation(start, target, START_AFTER_TARGET_MESSAGE);
  if (message) fail(400, "invalid_dates", message);
}

async function lockPlan(db: Db, planId: number): Promise<PlanRow> {
  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.id, planId))
    .for("update");
  if (!plan) throw new NotFoundError("Plan not found");
  return plan;
}

type GraphItem = PlanLayoutItem & {
  itemId: number;
  phaseId: number;
  title: string;
  dueDate: string | null;
  startDate: string | null;
  assigneeId: number | null;
  parentId: number | null;
  stateManual: boolean;
  rollupTotal: number | null;
};

async function loadGraph(
  db: Db,
  planId: number,
): Promise<{ phases: Array<typeof schema.planPhases.$inferSelect>; items: GraphItem[]; dependencies: PlanDependencyEdge[] }> {
  const phases = await db
    .select()
    .from(schema.planPhases)
    .where(eq(schema.planPhases.planId, planId))
    .orderBy(asc(schema.planPhases.sortOrder), asc(schema.planPhases.id));
  const rows = await db
    .select()
    .from(schema.planItems)
    .where(eq(schema.planItems.planId, planId))
    .orderBy(asc(schema.planItems.sortOrder), asc(schema.planItems.id));
  const taskIds = rows.filter((row) => row.entityType === "task").map((row) => row.entityId);
  const todoIds = rows.filter((row) => row.entityType === "todo").map((row) => row.entityId);
  const [tasks, todos, deps] = await Promise.all([
    taskIds.length === 0
      ? Promise.resolve([])
      : db.select().from(schema.tasks).where(inArray(schema.tasks.id, taskIds)),
    todoIds.length === 0
      ? Promise.resolve([])
      : db.select().from(schema.todos).where(inArray(schema.todos.id, todoIds)),
    taskIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            taskId: schema.taskDependencies.taskId,
            dependsOnTaskId: schema.taskDependencies.dependsOnTaskId,
          })
          .from(schema.taskDependencies)
          .where(
            and(
              inArray(schema.taskDependencies.taskId, taskIds),
              inArray(schema.taskDependencies.dependsOnTaskId, taskIds),
            ),
          ),
  ]);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const todosById = new Map(todos.map((todo) => [todo.id, todo]));
  const phaseSort = new Map(phases.map((phase) => [phase.id, phase.sortOrder]));
  const taskIdsInPlan = new Set(taskIds);
  const todoIdsInPlan = new Set(todoIds);
  const items: GraphItem[] = [];
  for (const row of rows) {
    if (row.entityType === "task") {
      const task = tasksById.get(row.entityId);
      if (!task) continue;
      const parent =
        task.parentId != null && taskIdsInPlan.has(task.parentId)
          ? { entityType: "task" as const, entityId: task.parentId }
          : null;
      items.push({
        itemId: row.id,
        phaseId: row.phaseId,
        entityType: "task",
        entityId: task.id,
        number: task.number,
        title: task.title,
        phaseSort: phaseSort.get(row.phaseId) ?? 0,
        itemSort: row.sortOrder,
        parent,
        parentId: task.parentId,
        state: task.state,
        estimateHours: hoursOf(task.estimateHours),
        progress: 0,
        dueDate: task.dueDate,
        startDate: task.startDate,
        assigneeId: task.assigneeId,
        stateManual: task.stateManual,
        rollupTotal: task.rollupTotal,
      });
    } else if (row.entityType === "todo") {
      const todo = todosById.get(row.entityId);
      if (!todo) continue;
      const parent =
        todo.parentId != null && todoIdsInPlan.has(todo.parentId)
          ? { entityType: "todo" as const, entityId: todo.parentId }
          : null;
      items.push({
        itemId: row.id,
        phaseId: row.phaseId,
        entityType: "todo",
        entityId: todo.id,
        number: todo.number,
        title: todo.title,
        phaseSort: phaseSort.get(row.phaseId) ?? 0,
        itemSort: row.sortOrder,
        parent,
        parentId: todo.parentId,
        state: todo.state,
        estimateHours: hoursOf(todo.estimateHours),
        progress: todo.progress,
        dueDate: todo.dueDate,
        startDate: todo.startDate,
        assigneeId: todo.assigneeId,
        stateManual: true,
        rollupTotal: null,
      });
    }
  }
  const dependencies: PlanDependencyEdge[] = deps.map((row) => ({
    prerequisite: { entityType: "task", entityId: row.dependsOnTaskId },
    dependent: { entityType: "task", entityId: row.taskId },
  }));
  return { phases, items, dependencies };
}

async function writeLayout(
  db: Db,
  planId: number,
  phases: Array<{ id: number; sortOrder: number }>,
  items: PlanLayoutItem[],
): Promise<void> {
  const phaseIdBySort = new Map(phases.map((phase) => [phase.sortOrder, phase.id]));
  for (const item of items) {
    const phaseId = phaseIdBySort.get(item.phaseSort);
    if (phaseId == null) fail(400, "invalid_phase", "Phase is not on this plan");
    await db
      .update(schema.planItems)
      .set({ phaseId, sortOrder: item.itemSort })
      .where(
        and(
          eq(schema.planItems.planId, planId),
          eq(schema.planItems.entityType, item.entityType),
          eq(schema.planItems.entityId, item.entityId),
        ),
      );
  }
}

function bumpRevision(plan: PlanRow, actorId: number) {
  return {
    revision: plan.revision + 1,
    updatedAt: new Date(),
    updatedById: actorId,
  };
}

/** Member and above may reorder. Viewers and strangers cannot. */
export async function assertCanReorderPlan(db: Db, actorId: number, planId: number): Promise<void> {
  await requirePlan(db, actorId, planId, "write");
}

const CANDIDATE_LIMIT = 50;

export async function listPlans(
  db: Db,
  actorId: number,
  filter: {
    projectId?: number;
    status?: string;
    entityType?: PlanEntityType;
    entityId?: number;
  },
) {
  const isAdmin = await userHasAdministrator(db, actorId);
  if (filter.projectId != null) {
    await assertCanAccessProject(db, actorId, filter.projectId, "read");
  }
  const scope = dualScopeListFilter(db, schema.plans.projectId, schema.plans.ownerId, actorId, isAdmin);
  const where = and(
    scope,
    filter.projectId != null ? eq(schema.plans.projectId, filter.projectId) : undefined,
    filter.status != null ? eq(schema.plans.status, filter.status) : undefined,
  );
  if (filter.entityType != null && filter.entityId != null) {
    const rows = await db
      .select({ plan: schema.plans })
      .from(schema.plans)
      .innerJoin(
        schema.planItems,
        and(
          eq(schema.planItems.planId, schema.plans.id),
          eq(schema.planItems.entityType, filter.entityType),
          eq(schema.planItems.entityId, filter.entityId),
        ),
      )
      .where(where)
      .orderBy(asc(schema.plans.number));
    return rows.map((row) => presentPlan(row.plan));
  }
  const rows = await db.select().from(schema.plans).where(where).orderBy(asc(schema.plans.number));
  return rows.map(presentPlan);
}

type CandidateSeed = {
  entityType: PlanEntityType;
  id: number;
  number: number;
  title: string;
  parentId: number | null;
  projectId: number | null;
  ownerId: number;
};

export async function searchPlanCandidates(db: Db, actorId: number, planId: number, query: string) {
  const plan = await requirePlan(db, actorId, planId, "structure");
  const membership = await db
    .select({ entityType: schema.planItems.entityType, entityId: schema.planItems.entityId })
    .from(schema.planItems)
    .where(eq(schema.planItems.planId, planId));
  const inPlan = new Set(membership.map((row) => `${row.entityType}:${row.entityId}`));
  const taskWhere =
    plan.projectId != null
      ? and(eq(schema.tasks.projectId, plan.projectId), ne(schema.tasks.state, "deleted"))
      : and(isNull(schema.tasks.projectId), eq(schema.tasks.ownerId, plan.ownerId), ne(schema.tasks.state, "deleted"));
  const todoWhere =
    plan.projectId != null
      ? and(eq(schema.todos.projectId, plan.projectId), ne(schema.todos.state, "deleted"))
      : and(isNull(schema.todos.projectId), eq(schema.todos.ownerId, plan.ownerId), ne(schema.todos.state, "deleted"));
  const [tasks, todos] = await Promise.all([
    db
      .select({
        id: schema.tasks.id,
        number: schema.tasks.number,
        title: schema.tasks.title,
        parentId: schema.tasks.parentId,
        projectId: schema.tasks.projectId,
        ownerId: schema.tasks.ownerId,
      })
      .from(schema.tasks)
      .where(taskWhere)
      .orderBy(desc(schema.tasks.number)),
    db
      .select({
        id: schema.todos.id,
        number: schema.todos.number,
        title: schema.todos.title,
        parentId: schema.todos.parentId,
        projectId: schema.todos.projectId,
        ownerId: schema.todos.ownerId,
      })
      .from(schema.todos)
      .where(todoWhere)
      .orderBy(desc(schema.todos.number)),
  ]);
  const seeds: CandidateSeed[] = [
    ...tasks.map((row) => ({ entityType: "task" as const, ...row })),
    ...todos.map((row) => ({ entityType: "todo" as const, ...row })),
  ];
  const matched = seeds
    .filter((row) => fitsPlan(plan, row) && !inPlan.has(`${row.entityType}:${row.id}`))
    .filter((row) => planCandidateMatches(row.entityType, row.number, row.title, query))
    .sort((a, b) => b.number - a.number || a.entityType.localeCompare(b.entityType))
    .slice(0, CANDIDATE_LIMIT);
  const childCounts = await candidateChildCounts(db, plan, matched, inPlan);
  const otherPlans = await candidateOtherPlans(db, actorId, planId, matched);
  return matched.map((row) => ({
    entityType: row.entityType,
    entityId: row.id,
    number: row.number,
    title: row.title,
    childCount: childCounts.get(`${row.entityType}:${row.id}`) ?? 0,
    otherPlans: otherPlans.get(`${row.entityType}:${row.id}`) ?? [],
  }));
}

async function candidateChildCounts(
  db: Db,
  plan: PlanRow,
  seeds: CandidateSeed[],
  inPlan: Set<string>,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const taskParents = seeds.filter((row) => row.entityType === "task").map((row) => row.id);
  const todoParents = seeds.filter((row) => row.entityType === "todo").map((row) => row.id);
  const bump = (entityType: PlanEntityType, parentId: number) => {
    const key = `${entityType}:${parentId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  if (taskParents.length > 0) {
    const children = await db
      .select({
        id: schema.tasks.id,
        parentId: schema.tasks.parentId,
        projectId: schema.tasks.projectId,
        ownerId: schema.tasks.ownerId,
      })
      .from(schema.tasks)
      .where(and(inArray(schema.tasks.parentId, taskParents), ne(schema.tasks.state, "deleted")));
    for (const child of children) {
      if (child.parentId == null || inPlan.has(`task:${child.id}`) || !fitsPlan(plan, child)) continue;
      bump("task", child.parentId);
    }
  }
  if (todoParents.length > 0) {
    const children = await db
      .select({
        id: schema.todos.id,
        parentId: schema.todos.parentId,
        projectId: schema.todos.projectId,
        ownerId: schema.todos.ownerId,
      })
      .from(schema.todos)
      .where(and(inArray(schema.todos.parentId, todoParents), ne(schema.todos.state, "deleted")));
    for (const child of children) {
      if (child.parentId == null || inPlan.has(`todo:${child.id}`) || !fitsPlan(plan, child)) continue;
      bump("todo", child.parentId);
    }
  }
  return counts;
}

async function candidateOtherPlans(
  db: Db,
  actorId: number,
  planId: number,
  seeds: CandidateSeed[],
): Promise<Map<string, Array<{ id: number; number: number; title: string }>>> {
  const grouped = new Map<string, Array<{ id: number; number: number; title: string }>>();
  const taskIds = seeds.filter((row) => row.entityType === "task").map((row) => row.id);
  const todoIds = seeds.filter((row) => row.entityType === "todo").map((row) => row.id);
  const entityMatch: SQL[] = [];
  const taskMatch =
    taskIds.length > 0
      ? and(eq(schema.planItems.entityType, "task"), inArray(schema.planItems.entityId, taskIds))
      : undefined;
  const todoMatch =
    todoIds.length > 0
      ? and(eq(schema.planItems.entityType, "todo"), inArray(schema.planItems.entityId, todoIds))
      : undefined;
  if (taskMatch) entityMatch.push(taskMatch);
  if (todoMatch) entityMatch.push(todoMatch);
  if (entityMatch.length === 0) return grouped;
  const isAdmin = await userHasAdministrator(db, actorId);
  const scope = dualScopeListFilter(db, schema.plans.projectId, schema.plans.ownerId, actorId, isAdmin);
  const rows = await db
    .select({
      entityType: schema.planItems.entityType,
      entityId: schema.planItems.entityId,
      id: schema.plans.id,
      number: schema.plans.number,
      title: schema.plans.title,
    })
    .from(schema.planItems)
    .innerJoin(schema.plans, eq(schema.plans.id, schema.planItems.planId))
    .where(and(ne(schema.plans.id, planId), scope, entityMatch.length === 1 ? entityMatch[0] : or(...entityMatch)));
  for (const row of rows) {
    const key = `${row.entityType}:${row.entityId}`;
    const list = grouped.get(key) ?? [];
    list.push({ id: row.id, number: row.number, title: row.title });
    grouped.set(key, list);
  }
  for (const list of grouped.values()) list.sort((a, b) => a.number - b.number);
  return grouped;
}

export async function getPlan(db: Db, actorId: number, planId: number) {
  const plan = await requirePlan(db, actorId, planId, "read");
  const phases = await db
    .select()
    .from(schema.planPhases)
    .where(eq(schema.planPhases.planId, planId))
    .orderBy(asc(schema.planPhases.sortOrder), asc(schema.planPhases.id));
  return { ...presentPlan(plan), phases };
}

export async function createPlan(
  db: Db,
  actorId: number,
  input: PlanWriteInput & {
    title: string;
    projectId?: number | null;
    phases?: PlanPhaseInput[];
  },
) {
  let projectStart: string | null = null;
  if (input.projectId != null) {
    const project = await assertCanAccessProject(db, actorId, input.projectId, "settings");
    projectStart = project.startDate;
  }
  const startDate = input.startDate === undefined ? projectStart : input.startDate;
  assertDates(startDate, input.targetDate ?? null);
  return db.transaction(async (tx) => {
    const number = await allocatePlanNumber(tx);
    const [plan] = await tx
      .insert(schema.plans)
      .values({
        number,
        projectId: input.projectId ?? null,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? "draft",
        targetDate: input.targetDate ?? null,
        startDate,
        ...(input.workdayHours !== undefined ? { workdayHours: input.workdayHours } : {}),
        capacityHoursPerWeek: input.capacityHoursPerWeek ?? null,
        ownerId: actorId,
        createdById: actorId,
        updatedById: actorId,
      })
      .returning();
    if (!plan) fail(500, "internal_error", "Plan was not created");
    let phaseInputs = input.phases;
    if (!phaseInputs || phaseInputs.length === 0) {
      if (plan.projectId != null) {
        const projectPhases = await tx
          .select()
          .from(schema.projectPhases)
          .where(eq(schema.projectPhases.projectId, plan.projectId))
          .orderBy(asc(schema.projectPhases.sortOrder), asc(schema.projectPhases.id));
        phaseInputs = projectPhases.map((phase) => ({ name: phase.name, color: null }));
      }
      if (!phaseInputs || phaseInputs.length === 0) phaseInputs = [{ name: "Phase 1" }];
    }
    const phases = await tx
      .insert(schema.planPhases)
      .values(
        phaseInputs.map((phase, index) => ({
          planId: plan.id,
          name: phase.name,
          color: phase.color ?? null,
          sortOrder: index,
        })),
      )
      .returning();
    return { ...presentPlan(plan), phases };
  });
}

export async function updatePlan(db: Db, actorId: number, planId: number, input: PlanWriteInput) {
  const existing = await requirePlan(db, actorId, planId, "structure");
  const startDate = input.startDate !== undefined ? input.startDate : existing.startDate;
  const targetDate = input.targetDate !== undefined ? input.targetDate : existing.targetDate;
  assertDates(startDate, targetDate);
  const [row] = await db
    .update(schema.plans)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.targetDate !== undefined ? { targetDate: input.targetDate } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.workdayHours !== undefined ? { workdayHours: input.workdayHours } : {}),
      ...(input.capacityHoursPerWeek !== undefined
        ? { capacityHoursPerWeek: input.capacityHoursPerWeek }
        : {}),
      updatedAt: new Date(),
      updatedById: actorId,
    })
    .where(eq(schema.plans.id, planId))
    .returning();
  if (!row) throw new NotFoundError("Plan not found");
  return presentPlan(row);
}

export async function deletePlan(db: Db, actorId: number, planId: number): Promise<void> {
  await requirePlan(db, actorId, planId, "structure");
  await db.delete(schema.plans).where(eq(schema.plans.id, planId));
}

export async function getPlanBoard(db: Db, actorId: number, planId: number) {
  const plan = await requirePlan(db, actorId, planId, "read");
  const graph = await loadGraph(db, planId);
  const canWrite = await actorCanWritePlan(db, actorId, plan);
  const canStructure = await actorCanStructurePlan(db, actorId, plan);
  const canReopen = await actorCanReopen(db, actorId, plan.projectId);
  const rollup = computePlanRollup(graph.items);
  const rollupByPhase = new Map(rollup.phases.map((phase) => [phase.phaseSort, phase]));
  const blockerLists = await Promise.all(
    graph.items
      .filter((item) => item.entityType === "task")
      .map(async (item) => ({
        entityId: item.entityId,
        blockers: await openDependsOnBlockers(db, item.entityId),
      })),
  );
  const blockersByTask = new Map(blockerLists.map((row) => [row.entityId, row.blockers]));
  const inPlanTasks = new Set(
    graph.items.filter((item) => item.entityType === "task").map((item) => item.entityId),
  );
  const withAssignees = await attachAssignees(db, graph.items);
  const phases = graph.phases.map((phase) => {
    const slice = rollupByPhase.get(phase.sortOrder);
    const { phaseSort: _phaseSort, ...phaseRollup } = slice ?? { phaseSort: phase.sortOrder, ...EMPTY_ROLLUP };
    return {
      id: phase.id,
      name: phase.name,
      color: phase.color,
      sortOrder: phase.sortOrder,
      rollup: phaseRollup,
      items: withAssignees
        .filter((item) => item.phaseId === phase.id)
        .sort((a, b) => a.itemSort - b.itemSort || a.itemId - b.itemId)
        .map((item) => {
          const blockers =
            item.entityType === "task" ? (blockersByTask.get(item.entityId) ?? []) : [];
          const external = blockers.filter((blocker) => !inPlanTasks.has(blocker.id));
          return {
            id: item.itemId,
            entityType: item.entityType,
            entityId: item.entityId,
            number: item.number,
            title: item.title,
            state: item.state,
            estimateHours: item.estimateHours,
            progress: item.entityType === "todo" ? item.progress : null,
            dueDate: item.dueDate,
            startDate: item.startDate,
            parentId: item.parentId,
            assignee: item.assignee,
            sortOrder: item.itemSort,
            actions: planItemActions({
              entityType: item.entityType,
              state: item.state,
              canWrite,
              canReopen,
              stateDerived: item.entityType === "task" && !item.stateManual && item.rollupTotal != null,
              openBlockers: blockers,
            }),
            externalBlockers: external,
          };
        }),
    };
  });
  return {
    plan: presentPlan(plan),
    rollup: rollup.plan,
    permissions: { canWriteItems: canWrite, canStructure },
    phases,
    edges: graph.dependencies,
  };
}

export async function createPhase(
  db: Db,
  actorId: number,
  planId: number,
  input: PlanPhaseInput,
) {
  await requirePlan(db, actorId, planId, "structure");
  const rows = await db
    .select({ sortOrder: schema.planPhases.sortOrder })
    .from(schema.planPhases)
    .where(eq(schema.planPhases.planId, planId));
  const sortOrder = rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
  const [phase] = await db
    .insert(schema.planPhases)
    .values({
      planId,
      name: input.name,
      color: input.color ?? null,
      sortOrder,
    })
    .returning();
  await db
    .update(schema.plans)
    .set({ updatedAt: new Date(), updatedById: actorId })
    .where(eq(schema.plans.id, planId));
  return phase;
}

export async function updatePhase(
  db: Db,
  actorId: number,
  planId: number,
  phaseId: number,
  input: Partial<PlanPhaseInput>,
) {
  await requirePlan(db, actorId, planId, "structure");
  const [phase] = await db
    .update(schema.planPhases)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.planPhases.id, phaseId), eq(schema.planPhases.planId, planId)))
    .returning();
  if (!phase) throw new NotFoundError("Phase not found");
  return phase;
}

export async function deletePhase(
  db: Db,
  actorId: number,
  planId: number,
  phaseId: number,
  moveItemsTo: number | null,
  revision: number | null,
): Promise<void> {
  await requirePlan(db, actorId, planId, "structure");
  await db.transaction(async (tx) => {
    const plan = await lockPlan(tx, planId);
    const graph = await loadGraph(tx, planId);
    const phase = graph.phases.find((row) => row.id === phaseId);
    if (!phase) throw new NotFoundError("Phase not found");
    const occupants = graph.items.filter((item) => item.phaseId === phaseId);
    if (occupants.length > 0) {
      if (moveItemsTo == null) {
        fail(409, "plan_phase_not_empty", "Phase still has items. Pass moveItemsTo to move them first.");
      }
      if (revision == null) fail(400, "validation_error", "revision: Required");
      assertPlanRevision(plan.revision, revision);
      const target = graph.phases.find((row) => row.id === moveItemsTo);
      if (!target || target.id === phaseId) {
        fail(400, "invalid_phase", "moveItemsTo must be another phase on this plan");
      }
      const staying = graph.items.filter((item) => item.phaseId !== phaseId);
      const moving = graph.items.filter((item) => item.phaseId === phaseId);
      const counts = new Map<number, number>();
      const laid = [...staying, ...moving.map((item) => ({ ...item, phaseSort: target.sortOrder }))]
        .sort((a, b) => {
          if (a.phaseSort !== b.phaseSort) return a.phaseSort - b.phaseSort;
          const aMoved = a.phaseId === phaseId ? 1 : 0;
          const bMoved = b.phaseId === phaseId ? 1 : 0;
          if (aMoved !== bMoved) return aMoved - bMoved;
          return a.itemSort - b.itemSort || a.itemId - b.itemId;
        })
        .map((item) => {
          const sort = counts.get(item.phaseSort) ?? 0;
          counts.set(item.phaseSort, sort + 1);
          return { ...item, itemSort: sort };
        });
      const violations = validatePlanOrder(laid, graph.dependencies);
      if (violations.length > 0) throw orderViolationError(violations);
      await writeLayout(
        tx,
        planId,
        graph.phases.filter((row) => row.id !== phaseId),
        laid,
      );
      await tx
        .update(schema.plans)
        .set(bumpRevision(plan, actorId))
        .where(eq(schema.plans.id, planId));
    }
    await tx.delete(schema.planPhases).where(eq(schema.planPhases.id, phaseId));
  });
}

export async function reorderPhases(
  db: Db,
  actorId: number,
  planId: number,
  revision: number,
  orderedPhaseIds: number[],
) {
  await requirePlan(db, actorId, planId, "structure");
  return db.transaction(async (tx) => {
    const plan = await lockPlan(tx, planId);
    assertPlanRevision(plan.revision, revision);
    const graph = await loadGraph(tx, planId);
    const currentIds = graph.phases.map((phase) => phase.id);
    if (
      orderedPhaseIds.length !== currentIds.length ||
      orderedPhaseIds.some((id) => !currentIds.includes(id))
    ) {
      fail(400, "invalid_phase", "orderedPhaseIds must list every phase on this plan once");
    }
    const sortById = new Map(orderedPhaseIds.map((id, index) => [id, index]));
    const items = graph.items.map((item) => ({
      ...item,
      phaseSort: sortById.get(item.phaseId) ?? item.phaseSort,
    }));
    const violations = validatePlanOrder(items, graph.dependencies);
    if (violations.length > 0) throw orderViolationError(violations);
    for (const [id, sortOrder] of sortById) {
      await tx
        .update(schema.planPhases)
        .set({ sortOrder, updatedAt: new Date() })
        .where(eq(schema.planPhases.id, id));
    }
    const [updated] = await tx
      .update(schema.plans)
      .set(bumpRevision(plan, actorId))
      .where(eq(schema.plans.id, planId))
      .returning();
    const phases = graph.phases
      .map((phase) => ({ ...phase, sortOrder: sortById.get(phase.id) ?? phase.sortOrder }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return { revision: updated?.revision ?? plan.revision + 1, phases };
  });
}

type EntityRow = {
  id: number;
  number: number;
  title: string;
  state: string;
  projectId: number | null;
  ownerId: number;
  parentId: number | null;
  estimateHours: unknown;
  progress: number;
  dueDate: string | null;
  startDate: string | null;
  assigneeId: number | null;
};

async function loadEntity(db: Db, entityType: PlanEntityType, entityId: number): Promise<EntityRow | null> {
  if (entityType === "task") {
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, entityId));
    if (!task) return null;
    return { ...task, progress: 0 };
  }
  const [todo] = await db.select().from(schema.todos).where(eq(schema.todos.id, entityId));
  return todo ?? null;
}

function fitsPlan(plan: PlanRow, entity: { projectId: number | null; ownerId: number }): boolean {
  if (plan.projectId != null) return entity.projectId === plan.projectId;
  return entity.projectId == null && entity.ownerId === plan.ownerId;
}

function toLayout(entityType: PlanEntityType, entity: EntityRow, parentInPlan: boolean): PlanLayoutItem {
  return {
    entityType,
    entityId: entity.id,
    number: entity.number,
    phaseSort: 0,
    itemSort: 0,
    parent: parentInPlan && entity.parentId != null ? { entityType, entityId: entity.parentId } : null,
    state: entity.state,
    estimateHours: hoursOf(entity.estimateHours),
    progress: entity.progress,
  };
}

export async function addPlanItem(
  db: Db,
  actorId: number,
  planId: number,
  input: {
    entityType: PlanEntityType;
    entityId: number;
    phaseId: number;
    afterItemId?: number | null;
    includeChildren?: boolean;
  },
) {
  await requirePlan(db, actorId, planId, "structure");
  await db.transaction(async (tx) => {
    const plan = await lockPlan(tx, planId);
    const graph = await loadGraph(tx, planId);
    const phase = graph.phases.find((row) => row.id === input.phaseId);
    if (!phase) throw new NotFoundError("Phase not found");
    const root = await loadEntity(tx, input.entityType, input.entityId);
    if (!root || root.state === "deleted") throw new NotFoundError("Item not found");
    if (!fitsPlan(plan, root)) {
      fail(400, "plan_item_project", "That item is not part of this plan's project.");
    }
    if (graph.items.some((item) => item.entityType === input.entityType && item.entityId === root.id)) {
      fail(409, "plan_item_exists", "That item is already in this plan.");
    }
    const members: EntityRow[] = [root];
    if (input.includeChildren) {
      const children =
        input.entityType === "task"
          ? await tx
              .select()
              .from(schema.tasks)
              .where(and(eq(schema.tasks.parentId, root.id), ne(schema.tasks.state, "deleted")))
          : await tx
              .select()
              .from(schema.todos)
              .where(and(eq(schema.todos.parentId, root.id), ne(schema.todos.state, "deleted")));
      for (const child of children) {
        if (!fitsPlan(plan, child)) continue;
        members.push({ ...child, progress: "progress" in child ? child.progress : 0 });
      }
    }
    const memberIds = new Set(members.map((entity) => entity.id));
    const block: PlanLayoutItem[] = members.map((entity) =>
      toLayout(
        input.entityType,
        entity,
        entity.parentId != null && memberIds.has(entity.parentId),
      ),
    );
    let after: PlanItemRef | null = null;
    if (input.afterItemId != null) {
      const anchor = graph.items.find((item) => item.itemId === input.afterItemId);
      if (!anchor || anchor.phaseId !== phase.id) {
        fail(400, "invalid_after", "afterItemId must be an item in the chosen phase");
      }
      after = { entityType: anchor.entityType, entityId: anchor.entityId };
    }
    const next = insertPlanBlock(graph.items, graph.dependencies, phase.sortOrder, block, after);
    if (!next) {
      const violations = rejectedInsertViolations(
        graph.items,
        graph.dependencies,
        phase.sortOrder,
        block,
        after,
      );
      throw orderViolationError(
        violations.length > 0
          ? violations
          : [{ kind: "dependency", message: "No legal slot in that phase" }],
      );
    }
    const existingKeys = new Set(graph.items.map((item) => itemKey(item)));
    for (const item of next) {
      const phaseId = graph.phases.find((row) => row.sortOrder === item.phaseSort)?.id;
      if (phaseId == null) fail(400, "invalid_phase", "Phase is not on this plan");
      if (existingKeys.has(itemKey(item))) {
        await tx
          .update(schema.planItems)
          .set({ phaseId, sortOrder: item.itemSort })
          .where(
            and(
              eq(schema.planItems.planId, planId),
              eq(schema.planItems.entityType, item.entityType),
              eq(schema.planItems.entityId, item.entityId),
            ),
          );
      } else {
        await tx.insert(schema.planItems).values({
          planId,
          phaseId,
          entityType: item.entityType,
          entityId: item.entityId,
          sortOrder: item.itemSort,
        });
      }
    }
    await tx.update(schema.plans).set(bumpRevision(plan, actorId)).where(eq(schema.plans.id, planId));
  });
  return getPlanBoard(db, actorId, planId);
}

export async function removePlanItem(db: Db, actorId: number, planId: number, itemId: number) {
  await requirePlan(db, actorId, planId, "structure");
  await db.transaction(async (tx) => {
    const plan = await lockPlan(tx, planId);
    const [row] = await tx
      .select()
      .from(schema.planItems)
      .where(and(eq(schema.planItems.id, itemId), eq(schema.planItems.planId, planId)));
    if (!row) throw new NotFoundError("Plan item not found");
    await tx.delete(schema.planItems).where(eq(schema.planItems.id, itemId));
    const graph = await loadGraph(tx, planId);
    const phaseItems = graph.items.filter((item) => item.phaseId === row.phaseId);
    for (let index = 0; index < phaseItems.length; index += 1) {
      const item = phaseItems[index];
      if (!item) continue;
      await tx
        .update(schema.planItems)
        .set({ sortOrder: index })
        .where(eq(schema.planItems.id, item.itemId));
    }
    await tx.update(schema.plans).set(bumpRevision(plan, actorId)).where(eq(schema.plans.id, planId));
  });
  return getPlanBoard(db, actorId, planId);
}

export async function reorderPlan(
  db: Db,
  actorId: number,
  planId: number,
  revision: number,
  phases: Array<{ phaseId: number; itemIds: number[] }>,
) {
  await requirePlan(db, actorId, planId, "write");
  await db.transaction(async (tx) => {
    const plan = await lockPlan(tx, planId);
    assertPlanRevision(plan.revision, revision);
    const graph = await loadGraph(tx, planId);
    const byId = new Map(graph.items.map((item) => [item.itemId, item]));
    const seen = new Set<number>();
    const next: PlanLayoutItem[] = [];
    if (phases.length !== graph.phases.length) {
      fail(400, "invalid_phase", "Reorder must include every phase");
    }
    phases.forEach((phase, phaseIndex) => {
      if (!graph.phases.some((row) => row.id === phase.phaseId)) {
        fail(400, "invalid_phase", "Phase is not on this plan");
      }
      for (const itemId of phase.itemIds) {
        const item = byId.get(itemId);
        if (!item) fail(400, "invalid_item", "Reorder listed an item that is not on this plan");
        if (seen.has(itemId)) fail(400, "invalid_item", "Reorder listed an item more than once");
        seen.add(itemId);
        next.push({ ...item, phaseSort: phaseIndex, itemSort: next.filter((row) => row.phaseSort === phaseIndex).length });
      }
    });
    if (seen.size !== graph.items.length) {
      fail(400, "invalid_item", "Reorder must include every item");
    }
    const violations = validatePlanOrder(next, graph.dependencies);
    if (violations.length > 0) throw orderViolationError(violations);
    const phaseSortById = new Map(phases.map((phase, index) => [phase.phaseId, index]));
    for (const [id, sortOrder] of phaseSortById) {
      await tx
        .update(schema.planPhases)
        .set({ sortOrder, updatedAt: new Date() })
        .where(eq(schema.planPhases.id, id));
    }
    await writeLayout(
      tx,
      planId,
      phases.map((phase, index) => ({ id: phase.phaseId, sortOrder: index })),
      next,
    );
    await tx.update(schema.plans).set(bumpRevision(plan, actorId)).where(eq(schema.plans.id, planId));
  });
  return getPlanBoard(db, actorId, planId);
}

export async function autoSortPlan(
  db: Db,
  actorId: number,
  planId: number,
  revision: number,
  apply: boolean,
) {
  await requirePlan(db, actorId, planId, "write");
  const plan = await requirePlan(db, actorId, planId, "write");
  assertPlanRevision(plan.revision, revision);
  const graph = await loadGraph(db, planId);
  const preview = previewFixOrder(graph.items, graph.dependencies);
  if (!apply) return { revision: plan.revision, preview, board: null };
  await db.transaction(async (tx) => {
    const locked = await lockPlan(tx, planId);
    assertPlanRevision(locked.revision, revision);
    const fresh = await loadGraph(tx, planId);
    const nextPreview = previewFixOrder(fresh.items, fresh.dependencies);
    let changed = false;
    for (const phase of nextPreview.phases) {
      if (!phase.changed) continue;
      changed = true;
      const phaseRow = fresh.phases.find((row) => row.sortOrder === phase.phaseSort);
      if (!phaseRow) continue;
      for (let index = 0; index < phase.items.length; index += 1) {
        const ref = phase.items[index];
        if (!ref) continue;
        await tx
          .update(schema.planItems)
          .set({ sortOrder: index })
          .where(
            and(
              eq(schema.planItems.planId, planId),
              eq(schema.planItems.phaseId, phaseRow.id),
              eq(schema.planItems.entityType, ref.entityType),
              eq(schema.planItems.entityId, ref.entityId),
            ),
          );
      }
    }
    if (changed) {
      await tx.update(schema.plans).set(bumpRevision(locked, actorId)).where(eq(schema.plans.id, planId));
    }
  });
  const board = await getPlanBoard(db, actorId, planId);
  return { revision: board.plan.revision, preview, board };
}

async function applyTaskState(
  db: Db,
  actorId: number,
  source: ActivitySource,
  taskId: number,
  to: string,
  stateComment: string | null,
): Promise<void> {
  const [existing] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
  if (!existing || existing.state === "deleted") throw new NotFoundError("Item not found");
  if (to === "complete") {
    const gate = await openDependsOnBlockers(db, taskId);
    if (gate.length > 0) fail(400, "blocked", formatBlockersMessage("complete", gate));
  }
  if (derivedStatePatchRejected(existing, { state: to })) {
    fail(400, "state_derived", "Status is derived from child tasks. Turn on Manual status to set it yourself.");
  }
  const canReopen = await actorCanReopen(db, actorId, existing.projectId);
  const steps = existing.state === "ready" && to === "complete" ? ["in_progress", "complete"] : [to];
  let from = existing.state;
  for (const step of steps) {
    enforceTaskPatch({
      fromState: from,
      canReopen,
      patch: { state: step, stateComment: step === steps[steps.length - 1] ? stateComment : undefined },
    });
    from = step;
  }
  const final = await db.transaction(async (tx) => {
    let current = existing;
    for (const step of steps) {
      const persisted = await resolvePersistedState(tx, taskId, current.state, step);
      const [updated] = await tx
        .update(schema.tasks)
        .set({
          state: persisted ?? step,
          updatedAt: new Date(),
          updatedById: actorId,
        })
        .where(eq(schema.tasks.id, taskId))
        .returning();
      if (!updated) throw new NotFoundError("Item not found");
      if (stateComment && step === steps[steps.length - 1] && updated.state !== current.state) {
        await tx.insert(schema.taskActivity).values({
          taskId,
          entityType: "task",
          entityId: taskId,
          kind: "comment",
          body: stateComment,
          createdById: actorId,
          source,
        });
      }
      await recordTaskChanges(tx, taskId, current, updated, { actorId, source });
      current = updated;
    }
    const opts = { actorId, source };
    await afterTaskHierarchyChange(tx, taskId, existing.parentId, opts);
    if (shouldPromoteBlockedDependents(existing.state, current.state)) {
      await promoteBlockedDependents(tx, taskId, opts);
    }
    if (shouldBlockReadyDependents(existing.state, current.state)) {
      await blockReadyDependents(tx, taskId, opts);
    }
    return current;
  });
  await scheduleKnowledgeIndex("task", final.id);
}

async function applyTodoState(
  db: Db,
  actorId: number,
  source: ActivitySource,
  todoId: number,
  to: string,
): Promise<void> {
  const [existing] = await db.select().from(schema.todos).where(eq(schema.todos.id, todoId));
  if (!existing || existing.state === "deleted") throw new NotFoundError("Item not found");
  const current = { progress: existing.progress, state: existing.state };
  const result =
    to === "complete"
      ? resolveTodoProgressUpdate(current, { state: "complete" })
      : to === "in_progress"
        ? resolveTodoCheckToggle(false, current)
        : null;
  if (!result) fail(400, "invalid_transition", "That state change is not available for this ToDo.");
  const appDb = db as typeof AppDatabase;
  await applyTodoProgressResult(appDb, todoId, actorId, result, source);
  await recomputeAncestorChain(appDb, existing.parentId, actorId, source);
  await scheduleKnowledgeIndex("todo", todoId);
}

export async function setPlanItemState(
  db: Db,
  actorId: number,
  planId: number,
  itemId: number,
  to: string,
  stateComment: string | null,
  source: ActivitySource,
) {
  await requirePlan(db, actorId, planId, "write");
  const [item] = await db
    .select()
    .from(schema.planItems)
    .where(and(eq(schema.planItems.id, itemId), eq(schema.planItems.planId, planId)));
  if (!item) throw new NotFoundError("Plan item not found");
  if (item.entityType === "task") {
    const [task] = await db
      .select({ projectId: schema.tasks.projectId, ownerId: schema.tasks.ownerId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, item.entityId));
    if (!task) throw new NotFoundError("Item not found");
    if (task.projectId != null) await assertCanAccessProject(db, actorId, task.projectId, "write");
    else await assertCanAccessOwned(db, actorId, task.ownerId);
    await applyTaskState(db, actorId, source, item.entityId, to, stateComment);
  } else if (item.entityType === "todo") {
    const [todo] = await db
      .select({ projectId: schema.todos.projectId, ownerId: schema.todos.ownerId })
      .from(schema.todos)
      .where(eq(schema.todos.id, item.entityId));
    if (!todo) throw new NotFoundError("Item not found");
    if (todo.projectId != null) await assertCanAccessProject(db, actorId, todo.projectId, "write");
    else await assertCanAccessOwned(db, actorId, todo.ownerId);
    await applyTodoState(db, actorId, source, item.entityId, to);
  } else {
    fail(400, "invalid_item", "Plan item type is not supported");
  }
  return getPlanBoard(db, actorId, planId);
}
