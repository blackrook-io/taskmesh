import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { EntityType } from "../lib/entityType.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import * as schema from "../db/schema.js";
import { NotFoundError } from "../lib/notFound.js";
import { findListedProjectRole, type ProjectUserRole } from "./projectUsers.js";
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

/** Access level required for a project-scoped operation (T0128). */
export type ProjectAccessLevel = "read" | "write" | "settings";

/**
 * Effective role for the actor on a project.
 * `admin` is global; `owner` is implicit Manager; listed roles come from junction tables.
 */
export type ProjectActorRole = "admin" | "owner" | ProjectUserRole;

export async function resolveProjectActorRole(
  db: Db,
  actorUserId: number,
  project: { id: number; ownerId: number },
): Promise<ProjectActorRole | null> {
  if (await userHasAdministrator(db, actorUserId)) return "admin";
  if (actorUserId === project.ownerId) return "owner";
  return findListedProjectRole(db, project.id, actorUserId);
}

export function roleSatisfiesAccess(
  role: ProjectActorRole | null,
  level: ProjectAccessLevel,
): boolean {
  if (role == null) return false;
  if (role === "admin" || role === "owner" || role === "manager") return true;
  if (role === "member") return level === "read" || level === "write";
  if (role === "viewer") return level === "read";
  return false;
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
 * Project ids the actor may **write** (owner / manager / member, direct or via
 * Group) — viewers excluded. Used where a "can see it" filter would otherwise
 * let a Viewer mutate, e.g. reorder (T0143).
 */
export function projectWriteListFilter(
  db: Db,
  actorUserId: number,
  isAdministrator: boolean,
): SQL | undefined {
  if (isAdministrator) return undefined;
  const owned = db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.ownerId, actorUserId));
  const asManager = db
    .select({ id: schema.projectManagers.projectId })
    .from(schema.projectManagers)
    .where(eq(schema.projectManagers.userId, actorUserId));
  const asMember = db
    .select({ id: schema.projectMembers.projectId })
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.userId, actorUserId));
  const actorGroups = db
    .select({ groupId: schema.groupMembers.groupId })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.userId, actorUserId));
  const asManagerGroup = db
    .select({ id: schema.projectManagerGroups.projectId })
    .from(schema.projectManagerGroups)
    .where(inArray(schema.projectManagerGroups.groupId, actorGroups));
  const asMemberGroup = db
    .select({ id: schema.projectMemberGroups.projectId })
    .from(schema.projectMemberGroups)
    .where(inArray(schema.projectMemberGroups.groupId, actorGroups));
  return or(
    inArray(schema.projects.id, owned),
    inArray(schema.projects.id, asManager),
    inArray(schema.projects.id, asMember),
    inArray(schema.projects.id, asManagerGroup),
    inArray(schema.projects.id, asMemberGroup),
  );
}

/** Subqueries for project ids the actor owns or is listed on (any role, including via Group). */
function accessibleProjectIdClauses(db: Db, actorUserId: number): SQL[] {
  const owned = db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.ownerId, actorUserId));
  const asManager = db
    .select({ id: schema.projectManagers.projectId })
    .from(schema.projectManagers)
    .where(eq(schema.projectManagers.userId, actorUserId));
  const asMember = db
    .select({ id: schema.projectMembers.projectId })
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.userId, actorUserId));
  const asViewer = db
    .select({ id: schema.projectViewers.projectId })
    .from(schema.projectViewers)
    .where(eq(schema.projectViewers.userId, actorUserId));
  const actorGroups = db
    .select({ groupId: schema.groupMembers.groupId })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.userId, actorUserId));
  const asManagerGroup = db
    .select({ id: schema.projectManagerGroups.projectId })
    .from(schema.projectManagerGroups)
    .where(inArray(schema.projectManagerGroups.groupId, actorGroups));
  const asMemberGroup = db
    .select({ id: schema.projectMemberGroups.projectId })
    .from(schema.projectMemberGroups)
    .where(inArray(schema.projectMemberGroups.groupId, actorGroups));
  const asViewerGroup = db
    .select({ id: schema.projectViewerGroups.projectId })
    .from(schema.projectViewerGroups)
    .where(inArray(schema.projectViewerGroups.groupId, actorGroups));
  return [
    inArray(schema.projects.id, owned),
    inArray(schema.projects.id, asManager),
    inArray(schema.projects.id, asMember),
    inArray(schema.projects.id, asViewer),
    inArray(schema.projects.id, asManagerGroup),
    inArray(schema.projects.id, asMemberGroup),
    inArray(schema.projects.id, asViewerGroup),
  ];
}

/**
 * Projects list filter: admins see all; others see owned + role-list membership.
 */
export function projectAccessListFilter(
  db: Db,
  actorUserId: number,
  isAdministrator: boolean,
): SQL | undefined {
  if (isAdministrator) return undefined;
  return or(...accessibleProjectIdClauses(db, actorUserId));
}

/**
 * Load a project and assert the actor may access it at the given level.
 * Missing project → 404; insufficient role → 403.
 */
export async function assertCanAccessProject(
  db: Db,
  actorUserId: number,
  projectId: number,
  level: ProjectAccessLevel = "read",
): Promise<typeof schema.projects.$inferSelect> {
  const [proj] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!proj) {
    throw new NotFoundError("Project not found");
  }
  const role = await resolveProjectActorRole(db, actorUserId, proj);
  if (!roleSatisfiesAccess(role, level)) {
    throw new OwnershipAccessError();
  }
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
  level: ProjectAccessLevel = "read",
): Promise<void> {
  if (projectId == null) return;
  await assertCanAccessProject(db, actorUserId, projectId, level);
}

/**
 * Dual-scope get/mutate: project-backed → project role; unsorted → row owner.
 * Admins pass via resolveProjectActorRole / assertCanAccessOwned.
 */
export async function assertCanAccessDualScoped(
  db: Db,
  actorUserId: number,
  row: { projectId: number | null; ownerId: number },
  level: ProjectAccessLevel = "read",
): Promise<void> {
  if (row.projectId != null) {
    await assertCanAccessProject(db, actorUserId, row.projectId, level);
    return;
  }
  await assertCanAccessOwned(db, actorUserId, row.ownerId);
}

/**
 * Assert the actor may access a taggable entity (idea / project / task / todo / document).
 * Missing entity → 404; insufficient access → 403.
 */
export async function assertCanAccessTaggableEntity(
  db: Db,
  actorUserId: number,
  entityType: "idea" | "project" | "task" | "todo" | "document",
  entityId: number,
  level: ProjectAccessLevel = "read",
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
      await assertCanAccessProject(db, actorUserId, entityId, level);
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
      await assertCanAccessDualScoped(db, actorUserId, row, level);
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
      await assertCanAccessDualScoped(db, actorUserId, row, level);
      return;
    }
    case "document": {
      const [row] = await db
        .select({ projectId: schema.projectDocuments.projectId })
        .from(schema.projectDocuments)
        .where(eq(schema.projectDocuments.id, entityId));
      if (!row) throw new NotFoundError("Entity not found");
      await assertCanAccessProject(db, actorUserId, row.projectId, level);
      return;
    }
    default: {
      const _exhaustive: never = entityType;
      throw new NotFoundError(`Unsupported entity type: ${_exhaustive}`);
    }
  }
}

/**
 * Assert the actor may access any `EntityType` record.
 * Missing or soft-deleted task/todo → 404. Insufficient role → 403.
 */
export async function assertCanAccessEntity(
  db: Db,
  actorUserId: number,
  entityType: EntityType,
  entityId: number,
  level: ProjectAccessLevel = "read",
): Promise<void> {
  switch (entityType) {
    case "idea":
    case "project":
    case "document":
      await assertCanAccessTaggableEntity(db, actorUserId, entityType, entityId, level);
      return;
    case "task":
    case "todo":
      await assertLiveTaskOrTodo(db, entityType, entityId);
      await assertCanAccessTaggableEntity(db, actorUserId, entityType, entityId, level);
      return;
    case "board":
    case "canvas":
    case "wiki_node": {
      const projectId = await projectIdForNestedEntity(db, entityType, entityId);
      await assertCanAccessProject(db, actorUserId, projectId, level);
      return;
    }
    case "todo_list":
    case "image_board": {
      const row = await dualScopedRow(db, entityType, entityId);
      await assertCanAccessDualScoped(db, actorUserId, row, level);
      return;
    }
    case "plan": {
      const [row] = await db
        .select({
          projectId: schema.plans.projectId,
          ownerId: schema.plans.ownerId,
        })
        .from(schema.plans)
        .where(eq(schema.plans.id, entityId));
      if (!row) throw new NotFoundError("Entity not found");
      await assertCanAccessDualScoped(db, actorUserId, row, level);
      return;
    }
    default: {
      const _exhaustive: never = entityType;
      throw new NotFoundError(`Unsupported entity type: ${_exhaustive}`);
    }
  }
}

/** Soft-deleted tasks and todos are invisible to link APIs. */
async function assertLiveTaskOrTodo(
  db: Db,
  entityType: "task" | "todo",
  entityId: number,
): Promise<void> {
  const table = entityType === "task" ? schema.tasks : schema.todos;
  const [row] = await db
    .select({ state: table.state })
    .from(table)
    .where(eq(table.id, entityId));
  if (!row || row.state === "deleted") {
    throw new NotFoundError("Entity not found");
  }
}

async function projectIdForNestedEntity(
  db: Db,
  entityType: "board" | "canvas" | "wiki_node",
  entityId: number,
): Promise<number> {
  if (entityType === "board") {
    const [row] = await db
      .select({ projectId: schema.boards.projectId })
      .from(schema.boards)
      .where(eq(schema.boards.id, entityId));
    if (!row) throw new NotFoundError("Entity not found");
    return row.projectId;
  }
  if (entityType === "canvas") {
    const [row] = await db
      .select({ projectId: schema.canvases.projectId })
      .from(schema.canvases)
      .where(eq(schema.canvases.id, entityId));
    if (!row) throw new NotFoundError("Entity not found");
    return row.projectId;
  }
  const [row] = await db
    .select({ projectId: schema.wikiNodes.projectId })
    .from(schema.wikiNodes)
    .where(eq(schema.wikiNodes.id, entityId));
  if (!row) throw new NotFoundError("Entity not found");
  return row.projectId;
}

async function dualScopedRow(
  db: Db,
  entityType: "todo_list" | "image_board",
  entityId: number,
): Promise<{ projectId: number | null; ownerId: number }> {
  if (entityType === "todo_list") {
    const [row] = await db
      .select({
        projectId: schema.todoLists.projectId,
        ownerId: schema.todoLists.ownerId,
      })
      .from(schema.todoLists)
      .where(eq(schema.todoLists.id, entityId));
    if (!row) throw new NotFoundError("Entity not found");
    return row;
  }
  const [row] = await db
    .select({
      projectId: schema.imageBoards.projectId,
      ownerId: schema.imageBoards.ownerId,
    })
    .from(schema.imageBoards)
    .where(eq(schema.imageBoards.id, entityId));
  if (!row) throw new NotFoundError("Entity not found");
  return row;
}

/**
 * Dual-scope list filter (tasks, todos, lists, image boards):
 * - Admins: no filter
 * - Others: (`project_id IS NULL` AND `owner_id = actor`) OR project accessible
 *   via ownership / direct role / group role (same set as `accessibleProjectIdClauses`)
 */
export function dualScopeListFilter(
  db: Db,
  projectIdColumn: AnyPgColumn,
  ownerIdColumn: AnyPgColumn,
  actorUserId: number,
  isAdministrator: boolean,
): SQL | undefined {
  if (isAdministrator) return undefined;
  return or(
    and(isNull(projectIdColumn), eq(ownerIdColumn, actorUserId)),
    ...accessibleProjectIdClausesForColumn(db, projectIdColumn, actorUserId),
  );
}

/**
 * Write-level counterpart to `dualScopeListFilter`: rows the actor may mutate —
 * standalone rows they own, or rows in a project they can write (owner / manager /
 * member, direct or via Group). Viewers are excluded (T0143).
 */
export function dualScopeWriteFilter(
  db: Db,
  projectIdColumn: AnyPgColumn,
  ownerIdColumn: AnyPgColumn,
  actorUserId: number,
  isAdministrator: boolean,
): SQL | undefined {
  if (isAdministrator) return undefined;
  return or(
    and(isNull(projectIdColumn), eq(ownerIdColumn, actorUserId)),
    ...writableProjectIdClausesForColumn(db, projectIdColumn, actorUserId),
  );
}

/**
 * List filter for project-nested rows (documents, boards, canvases, wiki):
 * - Admins: no filter
 * - Others: `project_id` in projects the actor can access (owner, any role list, or group)
 */
export function projectOwnedListFilter(
  db: Db,
  projectIdColumn: AnyPgColumn,
  actorUserId: number,
  isAdministrator: boolean,
): SQL | undefined {
  if (isAdministrator) return undefined;
  return or(...accessibleProjectIdClausesForColumn(db, projectIdColumn, actorUserId));
}

/** `inArray(column, subquery)` clauses matching `accessibleProjectIdClauses`. */
function accessibleProjectIdClausesForColumn(
  db: Db,
  projectIdColumn: AnyPgColumn,
  actorUserId: number,
): SQL[] {
  const owned = db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.ownerId, actorUserId));
  const asManager = db
    .select({ id: schema.projectManagers.projectId })
    .from(schema.projectManagers)
    .where(eq(schema.projectManagers.userId, actorUserId));
  const asMember = db
    .select({ id: schema.projectMembers.projectId })
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.userId, actorUserId));
  const asViewer = db
    .select({ id: schema.projectViewers.projectId })
    .from(schema.projectViewers)
    .where(eq(schema.projectViewers.userId, actorUserId));
  const actorGroups = db
    .select({ groupId: schema.groupMembers.groupId })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.userId, actorUserId));
  const asManagerGroup = db
    .select({ id: schema.projectManagerGroups.projectId })
    .from(schema.projectManagerGroups)
    .where(inArray(schema.projectManagerGroups.groupId, actorGroups));
  const asMemberGroup = db
    .select({ id: schema.projectMemberGroups.projectId })
    .from(schema.projectMemberGroups)
    .where(inArray(schema.projectMemberGroups.groupId, actorGroups));
  const asViewerGroup = db
    .select({ id: schema.projectViewerGroups.projectId })
    .from(schema.projectViewerGroups)
    .where(inArray(schema.projectViewerGroups.groupId, actorGroups));
  return [
    inArray(projectIdColumn, owned),
    inArray(projectIdColumn, asManager),
    inArray(projectIdColumn, asMember),
    inArray(projectIdColumn, asViewer),
    inArray(projectIdColumn, asManagerGroup),
    inArray(projectIdColumn, asMemberGroup),
    inArray(projectIdColumn, asViewerGroup),
  ];
}

/** Write subset: owner / manager / member (direct + group); no viewers. */
function writableProjectIdClausesForColumn(
  db: Db,
  projectIdColumn: AnyPgColumn,
  actorUserId: number,
): SQL[] {
  const owned = db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.ownerId, actorUserId));
  const asManager = db
    .select({ id: schema.projectManagers.projectId })
    .from(schema.projectManagers)
    .where(eq(schema.projectManagers.userId, actorUserId));
  const asMember = db
    .select({ id: schema.projectMembers.projectId })
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.userId, actorUserId));
  const actorGroups = db
    .select({ groupId: schema.groupMembers.groupId })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.userId, actorUserId));
  const asManagerGroup = db
    .select({ id: schema.projectManagerGroups.projectId })
    .from(schema.projectManagerGroups)
    .where(inArray(schema.projectManagerGroups.groupId, actorGroups));
  const asMemberGroup = db
    .select({ id: schema.projectMemberGroups.projectId })
    .from(schema.projectMemberGroups)
    .where(inArray(schema.projectMemberGroups.groupId, actorGroups));
  return [
    inArray(projectIdColumn, owned),
    inArray(projectIdColumn, asManager),
    inArray(projectIdColumn, asMember),
    inArray(projectIdColumn, asManagerGroup),
    inArray(projectIdColumn, asMemberGroup),
  ];
}
