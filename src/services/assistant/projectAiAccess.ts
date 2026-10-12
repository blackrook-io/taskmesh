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
  return null;
}

export async function projectsVisibleToAi(db: Db): Promise<SQL> {
  const ceiling = await getAiProjectAccessCeiling(db);
  if (ceiling === "excluded") return sql`false`;
  return sql`${schema.projects.aiAccess} <> 'excluded'`;
}

export async function tasksVisibleToAi(db: Db): Promise<SQL> {
  const ceiling = await getAiProjectAccessCeiling(db);
  if (ceiling === "excluded") return sql`${schema.tasks.projectId} is null`;
  return sql`(
    ${schema.tasks.projectId} is null
    or ${schema.tasks.projectId} in (
      select ${schema.projects.id} from ${schema.projects}
      where ${schema.projects.aiAccess} <> 'excluded'
    )
  )`;
}

export async function documentsVisibleToAi(db: Db): Promise<SQL> {
  const ceiling = await getAiProjectAccessCeiling(db);
  if (ceiling === "excluded") return sql`false`;
  return sql`${schema.projectDocuments.projectId} in (
    select ${schema.projects.id} from ${schema.projects}
    where ${schema.projects.aiAccess} <> 'excluded'
  )`;
}
