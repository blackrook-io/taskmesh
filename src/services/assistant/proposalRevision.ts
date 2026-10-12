import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

export const PROPOSAL_STALE_CHANGED = "The target changed since this proposal was made";
export const PROPOSAL_STALE_MISSING = "The target no longer exists";

export type RevisionConflict = "ok" | "missing" | "changed";

/** Compare a proposal's stamped `updatedAt` with the live row. No stamp means no check. */
export function revisionConflict(
  baseUpdatedAt: string | null | undefined,
  liveUpdatedAt: Date | string | null,
): RevisionConflict {
  if (baseUpdatedAt == null || baseUpdatedAt === "") return "ok";
  if (liveUpdatedAt == null) return "missing";
  const baseMs = Date.parse(baseUpdatedAt);
  const liveMs =
    liveUpdatedAt instanceof Date ? liveUpdatedAt.getTime() : Date.parse(liveUpdatedAt);
  if (!Number.isFinite(baseMs) || !Number.isFinite(liveMs) || baseMs !== liveMs) return "changed";
  return "ok";
}

export function beforeSnapshot(
  row: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const before: Record<string, unknown> = {};
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) {
      before[key] = null;
      continue;
    }
    const value = row[key];
    before[key] = value instanceof Date ? value.toISOString() : value;
  }
  return before;
}

export type ProposalRevisionStamp = {
  before?: Record<string, unknown>;
  baseUpdatedAt?: string;
  targetMissing?: boolean;
};

function asRecord(row: object): Record<string, unknown> {
  return { ...row };
}

function updatedAtOf(row: Record<string, unknown>): Date | null {
  const value = row.updatedAt;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return null;
}

export async function loadEntityRow(
  database: Db,
  entityType: string,
  entityId: number,
): Promise<Record<string, unknown> | null> {
  switch (entityType) {
    case "idea": {
      const [row] = await database.select().from(schema.ideas).where(eq(schema.ideas.id, entityId));
      return row ? asRecord(row) : null;
    }
    case "project": {
      const [row] = await database
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, entityId));
      return row ? asRecord(row) : null;
    }
    case "task": {
      const [row] = await database.select().from(schema.tasks).where(eq(schema.tasks.id, entityId));
      return row ? asRecord(row) : null;
    }
    case "document": {
      const [row] = await database
        .select()
        .from(schema.projectDocuments)
        .where(eq(schema.projectDocuments.id, entityId));
      return row ? asRecord(row) : null;
    }
    case "todo": {
      const [row] = await database.select().from(schema.todos).where(eq(schema.todos.id, entityId));
      return row ? asRecord(row) : null;
    }
    case "todo_list": {
      const [row] = await database
        .select()
        .from(schema.todoLists)
        .where(eq(schema.todoLists.id, entityId));
      return row ? asRecord(row) : null;
    }
    default:
      return null;
  }
}

/** Attach a before-image and revision token to an update proposal. Creates are unchanged. */
export async function stampProposalRevision(
  database: Db,
  proposal: {
    action: string;
    entityType: string;
    entityId?: number;
    fields: Record<string, unknown>;
  },
): Promise<ProposalRevisionStamp> {
  if (proposal.action !== "update" || proposal.entityId == null) return {};
  const row = await loadEntityRow(database, proposal.entityType, proposal.entityId);
  if (!row) return { targetMissing: true };
  const updatedAt = updatedAtOf(row);
  return {
    before: beforeSnapshot(row, Object.keys(proposal.fields)),
    ...(updatedAt ? { baseUpdatedAt: updatedAt.toISOString() } : {}),
  };
}
