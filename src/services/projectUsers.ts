import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { toGroupRef, type GroupRef } from "../lib/groupFields.js";
import { NotFoundError } from "../lib/notFound.js";
import { userCanAuthenticate } from "../lib/userAuth.js";
import { toUserRef, type UserRef } from "../lib/userFields.js";
import { listAssignableUserIds } from "./assignees.js";
import { groupHasAdministratorRole } from "./groups.js";
import { userHasAdministrator } from "./roles.js";

type Db = NodePgDatabase<typeof schema>;

export const PROJECT_USER_ROLES = ["manager", "member", "viewer"] as const;
export type ProjectUserRole = (typeof PROJECT_USER_ROLES)[number];

/**
 * No `email`: project Managers have no use case for member addresses, and
 * `UserRef.referenceId` (U####) already disambiguates duplicate display
 * names (T0143).
 */
export type ProjectUserEntry = UserRef & {
  role: ProjectUserRole;
  createdAt: string;
};

export type ProjectGroupEntry = GroupRef & {
  role: ProjectUserRole;
  memberCount: number;
  createdAt: string;
};

export type ProjectUsersLists = {
  managers: ProjectUserEntry[];
  members: ProjectUserEntry[];
  viewers: ProjectUserEntry[];
  managerGroups: ProjectGroupEntry[];
  memberGroups: ProjectGroupEntry[];
  viewerGroups: ProjectGroupEntry[];
  /** Project owner — always an implicit Manager (not stored in project_managers). */
  owner: UserRef;
};

export type AssigneeDisposition =
  | { disposition: "blank" }
  | { disposition: "reassign"; reassignToUserId: number };

export type ProjectUserAssignmentSummary = {
  taskCount: number;
  todoCount: number;
  total: number;
};

export class ProjectUsersError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ProjectUsersError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function tableForRole(role: ProjectUserRole) {
  switch (role) {
    case "manager":
      return schema.projectManagers;
    case "member":
      return schema.projectMembers;
    case "viewer":
      return schema.projectViewers;
  }
}

function groupTableForRole(role: ProjectUserRole) {
  switch (role) {
    case "manager":
      return schema.projectManagerGroups;
    case "member":
      return schema.projectMemberGroups;
    case "viewer":
      return schema.projectViewerGroups;
  }
}

function roleLabel(role: ProjectUserRole): string {
  switch (role) {
    case "manager":
      return "Managers";
    case "member":
      return "Members";
    case "viewer":
      return "Viewers";
  }
}

function roleRank(role: ProjectUserRole): number {
  switch (role) {
    case "manager":
      return 3;
    case "member":
      return 2;
    case "viewer":
      return 1;
  }
}

function maxRole(
  a: ProjectUserRole | null,
  b: ProjectUserRole | null,
): ProjectUserRole | null {
  if (a == null) return b;
  if (b == null) return a;
  return roleRank(a) >= roleRank(b) ? a : b;
}

async function loadProjectOrThrow(
  db: Db,
  projectId: number,
): Promise<typeof schema.projects.$inferSelect> {
  const [proj] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!proj) throw new NotFoundError("Project not found");
  return proj;
}

/** Direct user junction only (not via Group). */
export async function findDirectListedProjectRole(
  db: Db,
  projectId: number,
  userId: number,
): Promise<ProjectUserRole | null> {
  const [mgr] = await db
    .select({ id: schema.projectManagers.id })
    .from(schema.projectManagers)
    .where(
      and(
        eq(schema.projectManagers.projectId, projectId),
        eq(schema.projectManagers.userId, userId),
      ),
    )
    .limit(1);
  if (mgr) return "manager";
  const [mem] = await db
    .select({ id: schema.projectMembers.id })
    .from(schema.projectMembers)
    .where(
      and(
        eq(schema.projectMembers.projectId, projectId),
        eq(schema.projectMembers.userId, userId),
      ),
    )
    .limit(1);
  if (mem) return "member";
  const [view] = await db
    .select({ id: schema.projectViewers.id })
    .from(schema.projectViewers)
    .where(
      and(
        eq(schema.projectViewers.projectId, projectId),
        eq(schema.projectViewers.userId, userId),
      ),
    )
    .limit(1);
  if (view) return "viewer";
  return null;
}

async function findListedProjectRoleViaGroups(
  db: Db,
  projectId: number,
  userId: number,
): Promise<ProjectUserRole | null> {
  const memberships = await db
    .select({ groupId: schema.groupMembers.groupId })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.userId, userId));
  if (memberships.length === 0) return null;
  const groupIds = memberships.map((m) => m.groupId);

  const [mgr] = await db
    .select({ id: schema.projectManagerGroups.id })
    .from(schema.projectManagerGroups)
    .where(
      and(
        eq(schema.projectManagerGroups.projectId, projectId),
        inArray(schema.projectManagerGroups.groupId, groupIds),
      ),
    )
    .limit(1);
  if (mgr) return "manager";
  const [mem] = await db
    .select({ id: schema.projectMemberGroups.id })
    .from(schema.projectMemberGroups)
    .where(
      and(
        eq(schema.projectMemberGroups.projectId, projectId),
        inArray(schema.projectMemberGroups.groupId, groupIds),
      ),
    )
    .limit(1);
  if (mem) return "member";
  const [view] = await db
    .select({ id: schema.projectViewerGroups.id })
    .from(schema.projectViewerGroups)
    .where(
      and(
        eq(schema.projectViewerGroups.projectId, projectId),
        inArray(schema.projectViewerGroups.groupId, groupIds),
      ),
    )
    .limit(1);
  if (view) return "viewer";
  return null;
}

/**
 * Effective listed role (direct user junction or via Group); highest wins.
 * Not owner/admin. Used by ownership.resolveProjectActorRole.
 */
export async function findListedProjectRole(
  db: Db,
  projectId: number,
  userId: number,
): Promise<ProjectUserRole | null> {
  const [direct, viaGroup] = await Promise.all([
    findDirectListedProjectRole(db, projectId, userId),
    findListedProjectRoleViaGroups(db, projectId, userId),
  ]);
  return maxRole(direct, viaGroup);
}

async function listRoleEntries(
  db: Db,
  projectId: number,
  role: ProjectUserRole,
): Promise<ProjectUserEntry[]> {
  const table = tableForRole(role);
  const rows = await db
    .select({
      user: schema.users,
      createdAt: table.createdAt,
    })
    .from(table)
    .innerJoin(schema.users, eq(table.userId, schema.users.id))
    .where(eq(table.projectId, projectId))
    .orderBy(asc(schema.users.number));

  return rows.map((r) => ({
    ...toUserRef(r.user),
    role,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function listGroupRoleEntries(
  db: Db,
  projectId: number,
  role: ProjectUserRole,
): Promise<ProjectGroupEntry[]> {
  const table = groupTableForRole(role);
  const rows = await db
    .select({
      group: schema.groups,
      createdAt: table.createdAt,
    })
    .from(table)
    .innerJoin(schema.groups, eq(table.groupId, schema.groups.id))
    .where(eq(table.projectId, projectId))
    .orderBy(asc(schema.groups.number));

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.group.id);
  const counts = await db
    .select({
      groupId: schema.groupMembers.groupId,
      n: count(),
    })
    .from(schema.groupMembers)
    .where(inArray(schema.groupMembers.groupId, ids))
    .groupBy(schema.groupMembers.groupId);
  const countMap = new Map(counts.map((c) => [c.groupId, Number(c.n)]));

  return rows.map((r) => ({
    ...toGroupRef(r.group),
    role,
    memberCount: countMap.get(r.group.id) ?? 0,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listProjectUsers(db: Db, projectId: number): Promise<ProjectUsersLists> {
  const proj = await loadProjectOrThrow(db, projectId);
  const [owner] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, proj.ownerId))
    .limit(1);
  if (!owner) throw new NotFoundError("Project owner not found");

  const [managers, members, viewers, managerGroups, memberGroups, viewerGroups] =
    await Promise.all([
      listRoleEntries(db, projectId, "manager"),
      listRoleEntries(db, projectId, "member"),
      listRoleEntries(db, projectId, "viewer"),
      listGroupRoleEntries(db, projectId, "manager"),
      listGroupRoleEntries(db, projectId, "member"),
      listGroupRoleEntries(db, projectId, "viewer"),
    ]);

  return {
    managers,
    members,
    viewers,
    managerGroups,
    memberGroups,
    viewerGroups,
    owner: toUserRef(owner),
  };
}

export async function addProjectUser(
  db: Db,
  projectId: number,
  userId: number,
  role: ProjectUserRole,
): Promise<ProjectUserEntry> {
  const proj = await loadProjectOrThrow(db, projectId);

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) throw new NotFoundError("User not found");

  if (!userCanAuthenticate(user)) {
    throw new ProjectUsersError(
      400,
      "user_not_usable",
      "Only active, unlocked users can be added to a project.",
    );
  }

  if (await userHasAdministrator(db, userId)) {
    throw new ProjectUsersError(
      400,
      "administrator_not_listable",
      "Administrators already have access to all projects and cannot be added to role lists.",
    );
  }

  if (userId === proj.ownerId) {
    throw new ProjectUsersError(
      400,
      "owner_implicit_manager",
      "The project owner is already an implicit Manager and is not stored in role lists.",
    );
  }

  const existing = await findDirectListedProjectRole(db, projectId, userId);
  if (existing) {
    throw new ProjectUsersError(
      409,
      "already_assigned",
      existing === role
        ? `User is already in ${roleLabel(role)}.`
        : `User is already in ${roleLabel(existing)}. Move them by removing first.`,
    );
  }

  const table = tableForRole(role);
  const [row] = await db
    .insert(table)
    .values({ projectId, userId })
    .returning({ createdAt: table.createdAt });
  if (!row) {
    throw new ProjectUsersError(500, "insert_failed", "Could not add user to project");
  }

  return {
    ...toUserRef(user),
    role,
    createdAt: row.createdAt.toISOString(),
  };
}

async function findDirectListedProjectGroupRole(
  db: Db,
  projectId: number,
  groupId: number,
): Promise<ProjectUserRole | null> {
  for (const role of PROJECT_USER_ROLES) {
    const table = groupTableForRole(role);
    const [row] = await db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.projectId, projectId), eq(table.groupId, groupId)))
      .limit(1);
    if (row) return role;
  }
  return null;
}

export async function addProjectGroup(
  db: Db,
  projectId: number,
  groupId: number,
  role: ProjectUserRole,
): Promise<ProjectGroupEntry> {
  await loadProjectOrThrow(db, projectId);
  const [group] = await db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.id, groupId))
    .limit(1);
  if (!group) throw new NotFoundError("Group not found");

  if (await groupHasAdministratorRole(db, groupId)) {
    throw new ProjectUsersError(
      400,
      "administrator_group_not_listable",
      "Groups with the Administrator role already have access to all projects and cannot be added to role lists.",
    );
  }

  const existing = await findDirectListedProjectGroupRole(db, projectId, groupId);
  if (existing) {
    throw new ProjectUsersError(
      409,
      "already_assigned",
      existing === role
        ? `Group is already in ${roleLabel(role)}.`
        : `Group is already in ${roleLabel(existing)}. Move it by removing first.`,
    );
  }

  const table = groupTableForRole(role);
  const [row] = await db
    .insert(table)
    .values({ projectId, groupId })
    .returning({ createdAt: table.createdAt });
  if (!row) {
    throw new ProjectUsersError(500, "insert_failed", "Could not add group to project");
  }

  const [countRow] = await db
    .select({ n: count() })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.groupId, groupId));

  return {
    ...toGroupRef(group),
    role,
    memberCount: Number(countRow?.n ?? 0),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function removeProjectGroup(
  db: Db,
  projectId: number,
  groupId: number,
): Promise<ProjectUserRole | null> {
  await loadProjectOrThrow(db, projectId);
  const existing = await findDirectListedProjectGroupRole(db, projectId, groupId);
  if (!existing) return null;
  const table = groupTableForRole(existing);
  await db
    .delete(table)
    .where(and(eq(table.projectId, projectId), eq(table.groupId, groupId)));
  return existing;
}

export async function countUserProjectAssignments(
  db: Db,
  projectId: number,
  userId: number,
): Promise<ProjectUserAssignmentSummary> {
  const [taskRow] = await db
    .select({ n: count() })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.assigneeId, userId)));
  const [todoRow] = await db
    .select({ n: count() })
    .from(schema.todos)
    .where(and(eq(schema.todos.projectId, projectId), eq(schema.todos.assigneeId, userId)));
  const taskCount = Number(taskRow?.n ?? 0);
  const todoCount = Number(todoRow?.n ?? 0);
  return { taskCount, todoCount, total: taskCount + todoCount };
}

/**
 * Active, usable, non-administrator users for the Settings Add picker (Managers + Admins).
 * Excludes the project owner and anyone already on a direct role list.
 */
export async function listProjectDirectoryUsers(
  db: Db,
  projectId: number,
): Promise<UserRef[]> {
  const proj = await loadProjectOrThrow(db, projectId);
  const lists = await listProjectUsers(db, projectId);
  const excluded = new Set<number>([
    proj.ownerId,
    ...lists.managers.map((u) => u.id),
    ...lists.members.map((u) => u.id),
    ...lists.viewers.map((u) => u.id),
  ]);

  const rows = await db.select().from(schema.users).orderBy(asc(schema.users.number));
  const out: UserRef[] = [];
  for (const user of rows) {
    if (excluded.has(user.id)) continue;
    if (!userCanAuthenticate(user)) continue;
    if (await userHasAdministrator(db, user.id)) continue;
    // No email: Managers have no use case for member addresses, and `UserRef`
    // already carries `referenceId` (U####) for disambiguation (T0143).
    out.push(toUserRef(user));
  }
  return out;
}

/** Groups not yet on any project role list, excluding Administrator groups. */
export async function listProjectDirectoryGroups(
  db: Db,
  projectId: number,
): Promise<Array<GroupRef & { memberCount: number }>> {
  await loadProjectOrThrow(db, projectId);
  const lists = await listProjectUsers(db, projectId);
  const excluded = new Set<number>([
    ...lists.managerGroups.map((g) => g.id),
    ...lists.memberGroups.map((g) => g.id),
    ...lists.viewerGroups.map((g) => g.id),
  ]);

  const rows = await db.select().from(schema.groups).orderBy(asc(schema.groups.number));
  const out: Array<GroupRef & { memberCount: number }> = [];
  for (const group of rows) {
    if (excluded.has(group.id)) continue;
    if (await groupHasAdministratorRole(db, group.id)) continue;
    const [countRow] = await db
      .select({ n: count() })
      .from(schema.groupMembers)
      .where(eq(schema.groupMembers.groupId, group.id));
    out.push({
      ...toGroupRef(group),
      memberCount: Number(countRow?.n ?? 0),
    });
  }
  return out;
}

/**
 * Remove a user from whichever role list they are on for this project.
 * Manager/Member with assignees require disposition (reassign or blank).
 * Returns the role they left, or null if they were not listed.
 */
export async function removeProjectUser(
  db: Db,
  projectId: number,
  userId: number,
  disposition?: AssigneeDisposition | null,
): Promise<ProjectUserRole | null> {
  await loadProjectOrThrow(db, projectId);

  const existing = await findDirectListedProjectRole(db, projectId, userId);
  if (!existing) return null;

  const needsDisposition = existing === "manager" || existing === "member";
  if (needsDisposition) {
    const summary = await countUserProjectAssignments(db, projectId, userId);
    if (summary.total > 0) {
      if (!disposition) {
        throw new ProjectUsersError(
          409,
          "assignee_disposition_required",
          `This user is assigned to ${summary.total} task(s)/todo(s). Choose reassign or blank.`,
          summary,
        );
      }
      if (disposition.disposition === "reassign") {
        const targetId = disposition.reassignToUserId;
        if (targetId === userId) {
          throw new ProjectUsersError(
            400,
            "invalid_reassign_target",
            "Cannot reassign to the user being removed.",
          );
        }
        const pool = await listAssignableUserIds(db, projectId);
        const allowed = pool.filter((id) => id !== userId);
        if (!allowed.includes(targetId)) {
          throw new ProjectUsersError(
            400,
            "invalid_reassign_target",
            "Reassign target must remain an Owner, Manager, or Member after removal.",
          );
        }
        const [target] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, targetId))
          .limit(1);
        if (!target || !userCanAuthenticate(target)) {
          throw new ProjectUsersError(
            400,
            "invalid_reassign_target",
            "Reassign target user is not available.",
          );
        }
        await db.transaction(async (tx) => {
          await tx
            .update(schema.tasks)
            .set({ assigneeId: targetId, updatedAt: new Date() })
            .where(
              and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.assigneeId, userId)),
            );
          await tx
            .update(schema.todos)
            .set({ assigneeId: targetId, updatedAt: new Date() })
            .where(
              and(eq(schema.todos.projectId, projectId), eq(schema.todos.assigneeId, userId)),
            );
          const table = tableForRole(existing);
          await tx
            .delete(table)
            .where(and(eq(table.projectId, projectId), eq(table.userId, userId)));
        });
        return existing;
      }
      // blank
      await db.transaction(async (tx) => {
        await tx
          .update(schema.tasks)
          .set({ assigneeId: null, updatedAt: new Date() })
          .where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.assigneeId, userId)));
        await tx
          .update(schema.todos)
          .set({ assigneeId: null, updatedAt: new Date() })
          .where(and(eq(schema.todos.projectId, projectId), eq(schema.todos.assigneeId, userId)));
        const table = tableForRole(existing);
        await tx
          .delete(table)
          .where(and(eq(table.projectId, projectId), eq(table.userId, userId)));
      });
      return existing;
    }
  }

  const table = tableForRole(existing);
  await db
    .delete(table)
    .where(and(eq(table.projectId, projectId), eq(table.userId, userId)));
  return existing;
}
