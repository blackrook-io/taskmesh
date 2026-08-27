import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import * as schema from "../db/schema.js";
import { NotFoundError } from "../lib/notFound.js";
import { userHasAdministrator } from "./roles.js";

type Db = NodePgDatabase<typeof schema>;

export const ACCESS_DENIED_CODE = "access_denied";
export const ACCESS_DENIED_MESSAGE = "You do not have access to this record.";

export class OwnershipAccessError extends Error {
  readonly status = 403;
  readonly code = ACCESS_DENIED_CODE;

  constructor(message: string = ACCESS_DENIED_MESSAGE) {
    super(message);
    this.name = "OwnershipAccessError";
  }
}

/** True when the actor is an Administrator or owns the record. */
export function isAdminOrOwner(
  isAdministrator: boolean,
  actorUserId: number,
  ownerId: number,
): boolean {
  return isAdministrator || actorUserId === ownerId;
}

/**
 * Async check using DB admin role lookup.
 * Prefer this when the caller does not already know admin status.
 */
export async function canAccessOwned(
  db: Db,
  actorUserId: number,
  ownerId: number,
): Promise<boolean> {
  if (actorUserId === ownerId) return true;
  return userHasAdministrator(db, actorUserId);
}

/** Throw 403 OwnershipAccessError when the actor is neither owner nor admin. */
export async function assertCanAccessOwned(
  db: Db,
  actorUserId: number,
  ownerId: number,
): Promise<void> {
  if (!(await canAccessOwned(db, actorUserId, ownerId))) {
    throw new OwnershipAccessError();
  }
}

/**
 * List filter: admins see all rows; others only rows owned by `actorUserId`.
 * When `isAdministrator` is true, returns undefined (no filter).
 */
export function ownerScope(
  ownerColumn: AnyPgColumn,
  actorUserId: number,
  isAdministrator: boolean,
): SQL | undefined {
  if (isAdministrator) return undefined;
  return eq(ownerColumn, actorUserId);
}

/**
 * Load a project and assert the actor may access it via `projects.ownerId`.
 * Missing project → 404; non-owner non-admin → 403.
 */
export async function assertCanAccessProject(
  db: Db,
  actorUserId: number,
  projectId: number,
): Promise<typeof schema.projects.$inferSelect> {
  const [proj] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!proj) {
    throw new NotFoundError("Project not found");
  }
  await assertCanAccessOwned(db, actorUserId, proj.ownerId);
  return proj;
}

/**
 * When `projectId` is set, assert project-tree access.
 * When null/undefined, no-op (caller must use assertCanAccessDualScoped for unsorted rows).
 */
export async function assertCanAccessViaProject(
  db: Db,
  actorUserId: number,
  projectId: number | null | undefined,
): Promise<void> {
  if (projectId == null) return;
  await assertCanAccessProject(db, actorUserId, projectId);
}

/**
 * Dual-scope get/mutate: project-backed → project owner; unsorted → row owner.
 * Admins pass via assertCanAccessOwned / assertCanAccessProject.
 */
export async function assertCanAccessDualScoped(
  db: Db,
  actorUserId: number,
  row: { projectId: number | null; ownerId: number },
): Promise<void> {
  if (row.projectId != null) {
    await assertCanAccessProject(db, actorUserId, row.projectId);
    return;
  }
  await assertCanAccessOwned(db, actorUserId, row.ownerId);
}

/**
 * Assert the actor may access a taggable entity (idea / project / task / todo / document).
 * Missing entity → 404; non-owner non-admin → 403.
 */
export async function assertCanAccessTaggableEntity(
  db: Db,
  actorUserId: number,
  entityType: "idea" | "project" | "task" | "todo" | "document",
  entityId: number,
): Promise<void> {
  switch (entityType) {
    case "idea": {
      const [row] = await db
        .select({ ownerId: schema.ideas.ownerId })
        .from(schema.ideas)
        .where(eq(schema.ideas.id, entityId));
      if (!row) throw new NotFoundError("Entity not found");
      await assertCanAccessOwned(db, actorUserId, row.ownerId);
      return;
    }
    case "project": {
      await assertCanAccessProject(db, actorUserId, entityId);
      return;
    }
    case "task": {
      const [row] = await db
        .select({
          projectId: schema.tasks.projectId,
          ownerId: schema.tasks.ownerId,
        })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, entityId));
      if (!row) throw new NotFoundError("Entity not found");
      await assertCanAccessDualScoped(db, actorUserId, row);
      return;
    }
    case "todo": {
      const [row] = await db
        .select({
          projectId: schema.todos.projectId,
          ownerId: schema.todos.ownerId,
        })
        .from(schema.todos)
        .where(eq(schema.todos.id, entityId));
      if (!row) throw new NotFoundError("Entity not found");
      await assertCanAccessDualScoped(db, actorUserId, row);
      return;
    }
    case "document": {
      const [row] = await db
        .select({ projectId: schema.projectDocuments.projectId })
        .from(schema.projectDocuments)
        .where(eq(schema.projectDocuments.id, entityId));
      if (!row) throw new NotFoundError("Entity not found");
      await assertCanAccessProject(db, actorUserId, row.projectId);
      return;
    }
    default: {
      const _exhaustive: never = entityType;
      throw new NotFoundError(`Unsupported entity type: ${_exhaustive}`);
    }
  }
}

/**
 * Dual-scope list filter (tasks, todos, lists, image boards):
 * - Admins: no filter
 * - Others: (`project_id IS NULL` AND `owner_id = actor`) OR project owned by actor
 */
export function dualScopeListFilter(
  db: Db,
  projectIdColumn: AnyPgColumn,
  ownerIdColumn: AnyPgColumn,
  actorUserId: number,
  isAdministrator: boolean,
): SQL | undefined {
  if (isAdministrator) return undefined;
  const ownedProjectIds = db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.ownerId, actorUserId));
  return or(
    and(isNull(projectIdColumn), eq(ownerIdColumn, actorUserId)),
    inArray(projectIdColumn, ownedProjectIds),
  );
}
