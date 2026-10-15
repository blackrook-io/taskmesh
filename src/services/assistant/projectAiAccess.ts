import { eq, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import type { EntityType } from "../../lib/entityType.js";
import { getSystemProperties } from "../systemProperties.js";
import {
  effectiveAiAccess,
  isAiAccess,
  type AiAccess,
} from "./aiAccess.js";
import type { PolicyCheckInput } from "./aiPolicy.js";

export {
  AI_ACCESS_VALUES,
  aiAccessLabel,
  aiAccessWiderThan,
  aiPairExcluded,
  effectiveAiAccess,
  isAiAccess,
  linksVisibleToAi,
  narrowerAiAccess,
  type AiAccess,
} from "./aiAccess.js";

type Db = NodePgDatabase<typeof schema>;

export async function getAiProjectAccessCeiling(db: Db): Promise<AiAccess> {
  const props = await getSystemProperties(db);
  return props.aiProjectAccessDefault;
}

/** Stored flag OR the instance ceiling. A project can turn this on and cannot turn it off while the ceiling is on. */
export function effectiveAiLocalOnly(stored: boolean, ceiling: boolean): boolean {
  return stored || ceiling;
}

/** True when `candidate` would allow a cloud model the ceiling forbids. */
export function aiLocalOnlyWiderThanCeiling(candidate: boolean, ceiling: boolean): boolean {
  return !candidate && ceiling;
}

export async function getAiProjectLocalOnlyCeiling(db: Db): Promise<boolean> {
  const props = await getSystemProperties(db);
  return props.aiProjectLocalOnly;
}

export async function resolveEffectiveLocalOnly(db: Db, projectId: number): Promise<boolean | null> {
  const [row] = await db
    .select({ aiLocalOnly: schema.projects.aiLocalOnly })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!row) return null;
  return effectiveAiLocalOnly(row.aiLocalOnly, await getAiProjectLocalOnlyCeiling(db));
}

export async function loadStoredAiAccess(db: Db, projectId: number): Promise<AiAccess | null> {
  const [row] = await db
    .select({ aiAccess: schema.projects.aiAccess })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!row || !isAiAccess(row.aiAccess)) return null;
  return row.aiAccess;
}

export async function resolveEffectiveAiAccess(db: Db, projectId: number): Promise<AiAccess | null> {
  const stored = await loadStoredAiAccess(db, projectId);
  if (!stored) return null;
  return effectiveAiAccess(stored, await getAiProjectAccessCeiling(db));
}

export type ProjectAiAccessFields = {
  aiAccess: AiAccess;
  aiAccessEffective: AiAccess;
  aiAccessCeiling: AiAccess;
};

export type ProjectAiLocalOnlyFields = {
  aiLocalOnly: boolean;
  aiLocalOnlyEffective: boolean;
  aiLocalOnlyCeiling: boolean;
};

export async function projectAiLocalOnlyFields(
  db: Db,
  stored: boolean,
): Promise<ProjectAiLocalOnlyFields> {
  const ceiling = await getAiProjectLocalOnlyCeiling(db);
  return {
    aiLocalOnly: stored,
    aiLocalOnlyEffective: effectiveAiLocalOnly(stored, ceiling),
    aiLocalOnlyCeiling: ceiling,
  };
}

export async function projectAiAccessFields(
  db: Db,
  storedRaw: string,
): Promise<ProjectAiAccessFields> {
  const ceiling = await getAiProjectAccessCeiling(db);
  const stored = isAiAccess(storedRaw) ? storedRaw : "full";
  return {
    aiAccess: stored,
    aiAccessEffective: effectiveAiAccess(stored, ceiling),
    aiAccessCeiling: ceiling,
  };
}

function destinationProjectId(input: PolicyCheckInput): number | null {
  const raw = input.fields?.projectId;
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : null;
}

/**
 * Fill project access before `check`. A known project with no stored value stays unresolved
 * so the project layer fails closed.
 */
export async function attachProjectAiAccess(
  db: Db,
  input: PolicyCheckInput,
): Promise<PolicyCheckInput> {
  const next: PolicyCheckInput = { ...input };
  if (input.projectId != null && input.projectAiAccess == null) {
    const access = await resolveEffectiveAiAccess(db, input.projectId);
    if (access) next.projectAiAccess = access;
  }
  const destId = destinationProjectId(input);
  if (destId != null && destId !== input.projectId && input.destinationAiAccess == null) {
    const access = await resolveEffectiveAiAccess(db, destId);
    if (access) next.destinationAiAccess = access;
  }
  return next;
}

export async function projectIdForAiEntity(
  db: Db,
  entityType: EntityType | null | undefined,
  entityId: number | null | undefined,
): Promise<number | null> {
  if (entityId == null) return null;
  if (entityType === "project") return entityId;
  if (entityType === "document") {
    const [row] = await db
      .select({ projectId: schema.projectDocuments.projectId })
      .from(schema.projectDocuments)
      .where(eq(schema.projectDocuments.id, entityId));
    return row?.projectId ?? null;
  }
  if (entityType === "task") {
    const [row] = await db
      .select({ projectId: schema.tasks.projectId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, entityId));
    return row?.projectId ?? null;
  }
  if (entityType === "todo") {
    const [row] = await db
      .select({ projectId: schema.todos.projectId })
      .from(schema.todos)
      .where(eq(schema.todos.id, entityId));
    return row?.projectId ?? null;
  }
  if (entityType === "plan") {
    const [row] = await db
      .select({ projectId: schema.plans.projectId })
      .from(schema.plans)
      .where(eq(schema.plans.id, entityId));
    return row?.projectId ?? null;
  }
  if (entityType === "todo_list") {
    const [row] = await db
      .select({ projectId: schema.todoLists.projectId })
      .from(schema.todoLists)
      .where(eq(schema.todoLists.id, entityId));
    return row?.projectId ?? null;
  }
  return null;
}

function projectRowVisibleSql(routeLocalOnly: boolean, ceilingForcesLocal: boolean): SQL {
  const access = sql`${schema.projects.aiAccess} <> 'excluded'`;
  if (routeLocalOnly || !ceilingForcesLocal) {
    if (routeLocalOnly) return access;
    return sql`${access} and ${schema.projects.aiLocalOnly} = false`;
  }
  return sql`false`;
}

export async function projectsVisibleToAi(db: Db, routeLocalOnly = false): Promise<SQL> {
  const ceiling = await getAiProjectAccessCeiling(db);
  if (ceiling === "excluded") return sql`false`;
  const localCeiling = await getAiProjectLocalOnlyCeiling(db);
  return projectRowVisibleSql(routeLocalOnly, localCeiling);
}

export async function tasksVisibleToAi(db: Db, routeLocalOnly = false): Promise<SQL> {
  const ceiling = await getAiProjectAccessCeiling(db);
  if (ceiling === "excluded") return sql`${schema.tasks.projectId} is null`;
  const localCeiling = await getAiProjectLocalOnlyCeiling(db);
  if (!routeLocalOnly && localCeiling) return sql`${schema.tasks.projectId} is null`;
  return sql`(
    ${schema.tasks.projectId} is null
    or ${schema.tasks.projectId} in (
      select ${schema.projects.id} from ${schema.projects}
      where ${projectRowVisibleSql(routeLocalOnly, false)}
    )
  )`;
}

export async function todosVisibleToAi(db: Db, routeLocalOnly = false): Promise<SQL> {
  const ceiling = await getAiProjectAccessCeiling(db);
  if (ceiling === "excluded") return sql`${schema.todos.projectId} is null`;
  const localCeiling = await getAiProjectLocalOnlyCeiling(db);
  if (!routeLocalOnly && localCeiling) return sql`${schema.todos.projectId} is null`;
  return sql`(
    ${schema.todos.projectId} is null
    or ${schema.todos.projectId} in (
      select ${schema.projects.id} from ${schema.projects}
      where ${projectRowVisibleSql(routeLocalOnly, false)}
    )
  )`;
}

export async function todoListsVisibleToAi(db: Db, routeLocalOnly = false): Promise<SQL> {
  const ceiling = await getAiProjectAccessCeiling(db);
  if (ceiling === "excluded") return sql`${schema.todoLists.projectId} is null`;
  const localCeiling = await getAiProjectLocalOnlyCeiling(db);
  if (!routeLocalOnly && localCeiling) return sql`${schema.todoLists.projectId} is null`;
  return sql`(
    ${schema.todoLists.projectId} is null
    or ${schema.todoLists.projectId} in (
      select ${schema.projects.id} from ${schema.projects}
      where ${projectRowVisibleSql(routeLocalOnly, false)}
    )
  )`;
}

export async function documentsVisibleToAi(db: Db, routeLocalOnly = false): Promise<SQL> {
  const ceiling = await getAiProjectAccessCeiling(db);
  if (ceiling === "excluded") return sql`false`;
  const localCeiling = await getAiProjectLocalOnlyCeiling(db);
  if (!routeLocalOnly && localCeiling) return sql`false`;
  return sql`${schema.projectDocuments.projectId} in (
    select ${schema.projects.id} from ${schema.projects}
    where ${projectRowVisibleSql(routeLocalOnly, false)}
  )`;
}
