import { and, asc, eq, ne, notInArray, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { formatTaskNumber } from "../lib/taskFields.js";

type Db = NodePgDatabase<typeof schema>;

export type TaskDepSummary = {
  id: number;
  number: number;
  title: string;
  state: string;
};

/** States that no longer block Complete / Delete gates. */
export const TERMINAL_TASK_STATES = new Set(["complete", "canceled", "deleted"]);

export function isOpenTaskState(state: string): boolean {
  return !TERMINAL_TASK_STATES.has(state);
}

function depLabel(task: Pick<TaskDepSummary, "number" | "title">): string {
  return `${formatTaskNumber(task.number)} ${task.title}`;
}

/** True if adding taskId → dependsOnTaskId would create a cycle (or is self). */
export async function wouldCreateDependencyCycle(
  db: Db,
  taskId: number,
  dependsOnTaskId: number,
): Promise<boolean> {
  if (dependsOnTaskId === taskId) return true;
  const seen = new Set<number>();
  const queue = [dependsOnTaskId];
  while (queue.length > 0) {
    const cursor = queue.shift()!;
    if (cursor === taskId) return true;
    if (seen.has(cursor)) continue;
    seen.add(cursor);
    const outs = await db
      .select({ dependsOnTaskId: schema.taskDependencies.dependsOnTaskId })
      .from(schema.taskDependencies)
      .where(eq(schema.taskDependencies.taskId, cursor));
    for (const o of outs) queue.push(o.dependsOnTaskId);
  }
  return false;
}

export async function listDependsOn(db: Db, taskId: number): Promise<TaskDepSummary[]> {
  const rows = await db
    .select({
      id: schema.tasks.id,
      number: schema.tasks.number,
      title: schema.tasks.title,
      state: schema.tasks.state,
    })
    .from(schema.taskDependencies)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskDependencies.dependsOnTaskId))
    .where(eq(schema.taskDependencies.taskId, taskId))
    .orderBy(asc(schema.tasks.number));
  return rows;
}

export async function listRequiredBy(db: Db, taskId: number): Promise<TaskDepSummary[]> {
  const rows = await db
    .select({
      id: schema.tasks.id,
      number: schema.tasks.number,
      title: schema.tasks.title,
      state: schema.tasks.state,
    })
    .from(schema.taskDependencies)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskDependencies.taskId))
    .where(eq(schema.taskDependencies.dependsOnTaskId, taskId))
    .orderBy(asc(schema.tasks.number));
  return rows;
}

async function recordDepChange(
  db: Db,
  args: {
    taskId: number;
    field: "dependsOn" | "requiredBy";
    oldValue: string | null;
    newValue: string | null;
    actorId?: number | null;
    source?: "ui" | "api";
  },
): Promise<void> {
  await db.insert(schema.taskActivity).values({
    taskId: args.taskId,
    kind: "change",
    field: args.field,
    oldValue: args.oldValue ?? "none",
    newValue: args.newValue ?? "none",
    createdById: args.actorId ?? null,
    source: args.source ?? "api",
  });
}

export type AddDependencyResult =
  | { ok: true; dependsOn: TaskDepSummary[]; requiredBy: TaskDepSummary[] }
  | { ok: false; code: string; message: string };

export async function addDependency(
  db: Db,
  taskId: number,
  dependsOnTaskId: number,
  opts: { actorId?: number | null; source?: "ui" | "api" } = {},
): Promise<AddDependencyResult> {
  if (taskId === dependsOnTaskId) {
    return {
      ok: false,
      code: "invalid_dependency",
      message: "A task cannot depend on itself",
    };
  }

  const [dependent] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
  const [blocker] = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, dependsOnTaskId));
  if (!dependent || !blocker) {
    return { ok: false, code: "not_found", message: "Task not found" };
  }
  if (dependent.state === "deleted" || blocker.state === "deleted") {
    return {
      ok: false,
      code: "task_deleted",
      message: "Cannot link dependencies involving a deleted task",
    };
  }

  if (await wouldCreateDependencyCycle(db, taskId, dependsOnTaskId)) {
    return {
      ok: false,
      code: "dependency_cycle",
      message:
        "That dependency would create a cycle. The existing relationship stands; recursive dependencies are not allowed.",
    };
  }

  const [existing] = await db
    .select({ id: schema.taskDependencies.id })
    .from(schema.taskDependencies)
    .where(
      and(
        eq(schema.taskDependencies.taskId, taskId),
        eq(schema.taskDependencies.dependsOnTaskId, dependsOnTaskId),
      ),
    );
  if (existing) {
    return {
      ok: true,
      dependsOn: await listDependsOn(db, taskId),
      requiredBy: await listRequiredBy(db, taskId),
    };
  }

  await db.insert(schema.taskDependencies).values({ taskId, dependsOnTaskId });

  const labelBlocker = depLabel(blocker);
  const labelDependent = depLabel(dependent);
  await recordDepChange(db, {
    taskId,
    field: "dependsOn",
    oldValue: null,
    newValue: labelBlocker,
    actorId: opts.actorId,
    source: opts.source,
  });
  await recordDepChange(db, {
    taskId: dependsOnTaskId,
    field: "requiredBy",
    oldValue: null,
    newValue: labelDependent,
    actorId: opts.actorId,
    source: opts.source,
  });

  return {
    ok: true,
    dependsOn: await listDependsOn(db, taskId),
    requiredBy: await listRequiredBy(db, taskId),
  };
}

export type RemoveDependencyResult =
  | { ok: true; dependsOn: TaskDepSummary[]; requiredBy: TaskDepSummary[] }
  | { ok: false; code: string; message: string };

export async function removeDependency(
  db: Db,
  taskId: number,
  dependsOnTaskId: number,
  opts: { actorId?: number | null; source?: "ui" | "api" } = {},
): Promise<RemoveDependencyResult> {
  const [dependent] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
  const [blocker] = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, dependsOnTaskId));
  if (!dependent || !blocker) {
    return { ok: false, code: "not_found", message: "Task not found" };
  }

  const deleted = await db
    .delete(schema.taskDependencies)
    .where(
      and(
        eq(schema.taskDependencies.taskId, taskId),
        eq(schema.taskDependencies.dependsOnTaskId, dependsOnTaskId),
      ),
    )
    .returning({ id: schema.taskDependencies.id });

  if (deleted[0]) {
    const labelBlocker = depLabel(blocker);
    const labelDependent = depLabel(dependent);
    await recordDepChange(db, {
      taskId,
      field: "dependsOn",
      oldValue: labelBlocker,
      newValue: null,
      actorId: opts.actorId,
      source: opts.source,
    });
    await recordDepChange(db, {
      taskId: dependsOnTaskId,
      field: "requiredBy",
      oldValue: labelDependent,
      newValue: null,
      actorId: opts.actorId,
      source: opts.source,
    });
  }

  return {
    ok: true,
    dependsOn: await listDependsOn(db, taskId),
    requiredBy: await listRequiredBy(db, taskId),
  };
}

/** Open Depends-on tasks that block Complete. */
export async function openDependsOnBlockers(
  db: Db,
  taskId: number,
): Promise<TaskDepSummary[]> {
  const deps = await listDependsOn(db, taskId);
  return deps.filter((d) => isOpenTaskState(d.state));
}

/** Open Required-by tasks that block Delete. */
export async function openRequiredByBlockers(
  db: Db,
  taskId: number,
): Promise<TaskDepSummary[]> {
  const deps = await listRequiredBy(db, taskId);
  return deps.filter((d) => isOpenTaskState(d.state));
}

export function formatBlockersMessage(
  action: "complete" | "delete",
  blockers: TaskDepSummary[],
): string {
  const list = blockers.map((b) => `${formatTaskNumber(b.number)} (${b.state})`).join(", ");
  if (action === "complete") {
    return `Cannot mark Complete while dependencies are still open: ${list}`;
  }
  return `Cannot delete: required by open task(s): ${list}`;
}

/** Search tasks by title OR number (T#### / digits). Excludes ids when provided. */
export async function searchTasksForDependency(
  db: Db,
  q: string,
  opts?: { excludeIds?: number[]; limit?: number },
): Promise<TaskDepSummary[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const limit = opts?.limit ?? 20;
  const exclude = opts?.excludeIds?.filter((id) => Number.isFinite(id)) ?? [];
  const pattern = `%${trimmed}%`;
  const numFromToken = trimmed.match(/^t?0*(\d+)$/i);
  const numberEq =
    numFromToken != null ? Number(numFromToken[1]) : Number.NaN;
  /** Display form used in UI: T0001, T0042, … */
  const displayNumberSql = sql`('T' || LPAD(CAST(${schema.tasks.number} AS TEXT), 4, '0'))`;

  const filters = [
    ne(schema.tasks.state, "deleted"),
    or(
      sql`${schema.tasks.title} ILIKE ${pattern}`,
      sql`CAST(${schema.tasks.number} AS TEXT) ILIKE ${pattern}`,
      sql`${displayNumberSql} ILIKE ${pattern}`,
      Number.isFinite(numberEq) ? eq(schema.tasks.number, numberEq) : sql`false`,
    ),
  ];
  if (exclude.length > 0) {
    filters.push(notInArray(schema.tasks.id, exclude));
  }

  return db
    .select({
      id: schema.tasks.id,
      number: schema.tasks.number,
      title: schema.tasks.title,
      state: schema.tasks.state,
    })
    .from(schema.tasks)
    .where(and(...filters))
    .orderBy(asc(schema.tasks.number))
    .limit(limit);
}