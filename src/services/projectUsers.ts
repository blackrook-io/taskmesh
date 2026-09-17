import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { NotFoundError } from "../lib/notFound.js";
import { userCanAuthenticate } from "../lib/userAuth.js";
import { toUserRef, type UserRef } from "../lib/userFields.js";
import { userHasAdministrator } from "./roles.js";

type Db = NodePgDatabase<typeof schema>;

export const PROJECT_USER_ROLES = ["manager", "member", "viewer"] as const;
export type ProjectUserRole = (typeof PROJECT_USER_ROLES)[number];

export type ProjectUserEntry = UserRef & {
  email: string | null;
  role: ProjectUserRole;
  createdAt: string;
};

export type ProjectUsersLists = {
  managers: ProjectUserEntry[];
  members: ProjectUserEntry[];
  viewers: ProjectUserEntry[];
  /** Project owner — always an implicit Manager (not stored in project_managers). */
  owner: UserRef & { email: string | null };
};

export class ProjectUsersError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ProjectUsersError";
    this.status = status;
    this.code = code;
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

async function findExistingRole(
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
    email: r.user.email,
    role,
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

  const [managers, members, viewers] = await Promise.all([
    listRoleEntries(db, projectId, "manager"),
    listRoleEntries(db, projectId, "member"),
    listRoleEntries(db, projectId, "viewer"),
  ]);

  return {
    managers,
    members,
    viewers,
    owner: { ...toUserRef(owner), email: owner.email },
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

  const existing = await findExistingRole(db, projectId, userId);
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
    email: user.email,
    role,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Remove a user from whichever role list they are on for this project.
 * Returns the role they left, or null if they were not listed.
 */
export async function removeProjectUser(
  db: Db,
  projectId: number,
  userId: number,
): Promise<ProjectUserRole | null> {
  await loadProjectOrThrow(db, projectId);

  const existing = await findExistingRole(db, projectId, userId);
  if (!existing) return null;

  const table = tableForRole(existing);
  await db
    .delete(table)
    .where(and(eq(table.projectId, projectId), eq(table.userId, userId)));
  return existing;
}
