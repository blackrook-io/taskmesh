import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { userCanAuthenticate } from "../lib/userAuth.js";
import { toUserRef, type UserRef } from "../lib/userFields.js";

type Db = NodePgDatabase<typeof schema>;

export class AssigneeError extends Error {
  readonly status = 400;
  readonly code = "invalid_assignee";

  constructor(message: string) {
    super(message);
    this.name = "AssigneeError";
  }
}

/** True when the project has no managers, members, or viewers (Owner only) — users or Groups. */
export async function isSoloOwnerProject(db: Db, projectId: number): Promise<boolean> {
  const [mgr] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.projectManagers)
    .where(eq(schema.projectManagers.projectId, projectId));
  const [mem] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.projectId, projectId));
  const [view] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.projectViewers)
    .where(eq(schema.projectViewers.projectId, projectId));
  const [mgrG] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.projectManagerGroups)
    .where(eq(schema.projectManagerGroups.projectId, projectId));
  const [memG] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.projectMemberGroups)
    .where(eq(schema.projectMemberGroups.projectId, projectId));
  const [viewG] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.projectViewerGroups)
    .where(eq(schema.projectViewerGroups.projectId, projectId));
  return (
    (mgr?.n ?? 0) === 0 &&
    (mem?.n ?? 0) === 0 &&
    (view?.n ?? 0) === 0 &&
    (mgrG?.n ?? 0) === 0 &&
    (memG?.n ?? 0) === 0 &&
    (viewG?.n ?? 0) === 0
  );
}

/** Assignable user ids for a project: Owner ∪ managers ∪ members (exclude viewers), including via Groups. */
export async function listAssignableUserIds(db: Db, projectId: number): Promise<number[]> {
  const [proj] = await db
    .select({ ownerId: schema.projects.ownerId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!proj) return [];

  const [managers, members, managerGroups, memberGroups] = await Promise.all([
    db
      .select({ userId: schema.projectManagers.userId })
      .from(schema.projectManagers)
      .where(eq(schema.projectManagers.projectId, projectId)),
    db
      .select({ userId: schema.projectMembers.userId })
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.projectId, projectId)),
    db
      .select({ groupId: schema.projectManagerGroups.groupId })
      .from(schema.projectManagerGroups)
      .where(eq(schema.projectManagerGroups.projectId, projectId)),
    db
      .select({ groupId: schema.projectMemberGroups.groupId })
      .from(schema.projectMemberGroups)
      .where(eq(schema.projectMemberGroups.projectId, projectId)),
  ]);

  const ids = new Set<number>([proj.ownerId]);
  for (const row of managers) ids.add(row.userId);
  for (const row of members) ids.add(row.userId);

  const groupIds = [
    ...managerGroups.map((g) => g.groupId),
    ...memberGroups.map((g) => g.groupId),
  ];
  if (groupIds.length > 0) {
    const memberRows = await db
      .select({ userId: schema.groupMembers.userId })
      .from(schema.groupMembers)
      .where(inArray(schema.groupMembers.groupId, groupIds));
    for (const row of memberRows) ids.add(row.userId);
  }

  return [...ids];
}

/** Active assignable users as UserRef[], sorted by displayName. */
export async function listAssignableUsers(db: Db, projectId: number): Promise<UserRef[]> {
  const ids = await listAssignableUserIds(db, projectId);
  if (ids.length === 0) return [];
  const rows = await db.select().from(schema.users).where(inArray(schema.users.id, ids));
  return rows
    .filter((u) => userCanAuthenticate(u))
    .map(toUserRef)
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id - b.id);
}

export async function assertAssigneeAllowed(
  db: Db,
  projectId: number | null,
  assigneeId: number | null,
): Promise<void> {
  if (assigneeId == null) return;
  if (projectId == null) {
    throw new AssigneeError("Assignee requires a project (Owner, Manager, or Member)");
  }
  const allowed = await listAssignableUserIds(db, projectId);
  if (!allowed.includes(assigneeId)) {
    throw new AssigneeError(
      "Assignee must be the Project Owner, a Manager, or a Member (not a Viewer)",
    );
  }
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, assigneeId))
    .limit(1);
  if (!user || !userCanAuthenticate(user)) {
    throw new AssigneeError("Assignee user is not available");
  }
}

/**
 * Resolve assignee for create/update.
 * - `requested === undefined`: apply auto rules only (create / project move).
 * - `requested === null`: clear.
 * - `requested === number`: validate against pool.
 */
export async function resolveAssigneeId(
  db: Db,
  opts: {
    projectId: number | null;
    requested?: number | null;
    previousAssigneeId?: number | null;
    /** True when creating a new row. */
    creating?: boolean;
    /** True when projectId is changing on an existing row. */
    projectChanging?: boolean;
  },
): Promise<number | null> {
  const { projectId, requested, previousAssigneeId = null, creating, projectChanging } = opts;

  if (requested !== undefined) {
    await assertAssigneeAllowed(db, projectId, requested);
    return requested;
  }

  if (projectId == null) {
    return null;
  }

  if (creating || projectChanging) {
    if (await isSoloOwnerProject(db, projectId)) {
      const [proj] = await db
        .select({ ownerId: schema.projects.ownerId })
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
      return proj?.ownerId ?? null;
    }
    if (projectChanging) {
      if (previousAssigneeId == null) return null;
      const allowed = await listAssignableUserIds(db, projectId);
      return allowed.includes(previousAssigneeId) ? previousAssigneeId : null;
    }
    return null;
  }

  return previousAssigneeId;
}

/** Ideas have no project — assignee must stay null. */
export function resolveIdeaAssigneeId(requested?: number | null): number | null {
  if (requested === undefined || requested === null) return null;
  throw new AssigneeError("Ideas cannot be assigned (no project pool)");
}
