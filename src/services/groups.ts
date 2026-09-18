import { and, asc, count, eq, inArray, max, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { toGroupRef, type GroupRef } from "../lib/groupFields.js";
import {
  ADMINISTRATOR_SLUG,
  isAdministratorSlug,
  lastAdministratorDenied,
  toRoleRef,
  type RoleRef,
} from "../lib/roles.js";
import { toUserRef, type UserRef } from "../lib/userFields.js";
import { userCanAuthenticate } from "../lib/userAuth.js";
import {
  countAdministratorUsers,
  listRolesForUser,
  requireRoleExists,
  userHasAdministrator,
} from "./roles.js";

type Db = NodePgDatabase<typeof schema>;

function serviceErr(message: string, status: number, code: string): Error {
  return Object.assign(new Error(message), { status, code });
}

export type GroupMemberRef = UserRef & { email: string | null };

export type GroupSummary = GroupRef & {
  memberCount: number;
  roles: RoleRef[];
  createdAt: string;
  updatedAt: string;
};

export type GroupDetail = GroupSummary & {
  members: GroupMemberRef[];
};

async function nextGroupNumber(db: Db): Promise<number> {
  const [row] = await db.select({ m: max(schema.groups.number) }).from(schema.groups);
  return (row?.m ?? 0) + 1;
}

async function requireGroup(
  db: Db,
  groupId: number,
): Promise<typeof schema.groups.$inferSelect> {
  const [row] = await db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.id, groupId))
    .limit(1);
  if (!row) throw serviceErr("Group not found", 404, "not_found");
  return row;
}

async function listRolesForGroup(db: Db, groupId: number): Promise<RoleRef[]> {
  const rows = await db
    .select({
      id: schema.roles.id,
      name: schema.roles.name,
      slug: schema.roles.slug,
      isSystem: schema.roles.isSystem,
    })
    .from(schema.groupRoles)
    .innerJoin(schema.roles, eq(schema.groupRoles.roleId, schema.roles.id))
    .where(eq(schema.groupRoles.groupId, groupId))
    .orderBy(asc(schema.roles.name));
  return rows.map(toRoleRef);
}

async function listMembersForGroup(db: Db, groupId: number): Promise<GroupMemberRef[]> {
  const rows = await db
    .select({ user: schema.users })
    .from(schema.groupMembers)
    .innerJoin(schema.users, eq(schema.groupMembers.userId, schema.users.id))
    .where(eq(schema.groupMembers.groupId, groupId))
    .orderBy(asc(schema.users.number));
  return rows.map((r) => ({ ...toUserRef(r.user), email: r.user.email }));
}

async function memberCountForGroup(db: Db, groupId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.groupId, groupId));
  return Number(row?.n ?? 0);
}

export async function listGroups(db: Db): Promise<GroupSummary[]> {
  const rows = await db.select().from(schema.groups).orderBy(asc(schema.groups.number));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const memberCounts = await db
    .select({
      groupId: schema.groupMembers.groupId,
      n: count(),
    })
    .from(schema.groupMembers)
    .where(inArray(schema.groupMembers.groupId, ids))
    .groupBy(schema.groupMembers.groupId);
  const countMap = new Map(memberCounts.map((r) => [r.groupId, Number(r.n)]));

  const roleRows = await db
    .select({
      groupId: schema.groupRoles.groupId,
      id: schema.roles.id,
      name: schema.roles.name,
      slug: schema.roles.slug,
      isSystem: schema.roles.isSystem,
    })
    .from(schema.groupRoles)
    .innerJoin(schema.roles, eq(schema.groupRoles.roleId, schema.roles.id))
    .where(inArray(schema.groupRoles.groupId, ids));
  const rolesMap = new Map<number, RoleRef[]>();
  for (const id of ids) rolesMap.set(id, []);
  for (const row of roleRows) {
    rolesMap.get(row.groupId)?.push(toRoleRef(row));
  }
  for (const list of rolesMap.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  return rows.map((r) => ({
    ...toGroupRef(r),
    memberCount: countMap.get(r.id) ?? 0,
    roles: rolesMap.get(r.id) ?? [],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function getGroup(db: Db, groupId: number): Promise<GroupDetail> {
  const row = await requireGroup(db, groupId);
  const [members, roles, memberCount] = await Promise.all([
    listMembersForGroup(db, groupId),
    listRolesForGroup(db, groupId),
    memberCountForGroup(db, groupId),
  ]);
  return {
    ...toGroupRef(row),
    memberCount,
    roles,
    members,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createGroup(
  db: Db,
  name: string,
  createdById: number | null,
): Promise<GroupDetail> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw serviceErr("Group name is required", 400, "invalid_group_name");
  }
  const [dup] = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.name, trimmed))
    .limit(1);
  if (dup) {
    throw serviceErr("A group with that name already exists", 409, "group_taken");
  }
  const number = await nextGroupNumber(db);
  const [row] = await db
    .insert(schema.groups)
    .values({
      number,
      name: trimmed,
      createdById: createdById ?? null,
    })
    .returning();
  if (!row) throw serviceErr("Could not create group", 500, "create_failed");
  return getGroup(db, row.id);
}

export async function renameGroup(
  db: Db,
  groupId: number,
  name: string,
): Promise<GroupDetail> {
  await requireGroup(db, groupId);
  const trimmed = name.trim();
  if (!trimmed) {
    throw serviceErr("Group name is required", 400, "invalid_group_name");
  }
  const [dup] = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(and(eq(schema.groups.name, trimmed), sql`${schema.groups.id} <> ${groupId}`))
    .limit(1);
  if (dup) {
    throw serviceErr("A group with that name already exists", 409, "group_taken");
  }
  await db
    .update(schema.groups)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(schema.groups.id, groupId));
  return getGroup(db, groupId);
}

export async function deleteGroup(db: Db, groupId: number): Promise<void> {
  const roles = await listRolesForGroup(db, groupId);
  if (roles.some((r) => isAdministratorSlug(r.slug))) {
    const afterCount = await countEffectiveAdminsExcludingGroup(db, groupId);
    if (afterCount < 1) {
      const denied = lastAdministratorDenied("delete");
      throw serviceErr(denied.message, denied.status, denied.code);
    }
  }
  await db.delete(schema.groups).where(eq(schema.groups.id, groupId));
}

async function userHasDirectAdministrator(db: Db, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(
      and(
        eq(schema.userRoles.userId, userId),
        eq(schema.roles.slug, ADMINISTRATOR_SLUG),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function userHasAdministratorViaOtherGroups(
  db: Db,
  userId: number,
  excludeGroupId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ groupId: schema.groupMembers.groupId })
    .from(schema.groupMembers)
    .innerJoin(schema.groupRoles, eq(schema.groupMembers.groupId, schema.groupRoles.groupId))
    .innerJoin(schema.roles, eq(schema.groupRoles.roleId, schema.roles.id))
    .where(
      and(
        eq(schema.groupMembers.userId, userId),
        eq(schema.roles.slug, ADMINISTRATOR_SLUG),
        sql`${schema.groupMembers.groupId} <> ${excludeGroupId}`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Distinct users who remain Administrators if `excludeGroupId` is deleted / loses Admin. */
async function countEffectiveAdminsExcludingGroup(
  db: Db,
  excludeGroupId: number,
): Promise<number> {
  const direct = await db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(eq(schema.roles.slug, ADMINISTRATOR_SLUG));
  const viaOtherGroups = await db
    .select({ userId: schema.groupMembers.userId })
    .from(schema.groupMembers)
    .innerJoin(schema.groupRoles, eq(schema.groupMembers.groupId, schema.groupRoles.groupId))
    .innerJoin(schema.roles, eq(schema.groupRoles.roleId, schema.roles.id))
    .where(
      and(
        eq(schema.roles.slug, ADMINISTRATOR_SLUG),
        sql`${schema.groupMembers.groupId} <> ${excludeGroupId}`,
      ),
    );
  const set = new Set<number>();
  for (const r of direct) set.add(r.userId);
  for (const r of viaOtherGroups) set.add(r.userId);
  return set.size;
}

export async function addGroupMember(
  db: Db,
  groupId: number,
  userId: number,
): Promise<GroupDetail> {
  await requireGroup(db, groupId);
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) throw serviceErr("User not found", 404, "not_found");
  if (!userCanAuthenticate(user)) {
    throw serviceErr(
      "Only active, unlocked users can be added to a group",
      400,
      "user_not_usable",
    );
  }
  try {
    await db.insert(schema.groupMembers).values({ groupId, userId });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      // already a member
    } else {
      throw err;
    }
  }
  await db
    .update(schema.groups)
    .set({ updatedAt: new Date() })
    .where(eq(schema.groups.id, groupId));
  return getGroup(db, groupId);
}

export async function removeGroupMember(
  db: Db,
  groupId: number,
  userId: number,
): Promise<GroupDetail> {
  await requireGroup(db, groupId);
  const roles = await listRolesForGroup(db, groupId);
  if (roles.some((r) => isAdministratorSlug(r.slug))) {
    // Removing this member may demote their last Admin path.
    const stillAdminAfter =
      (await userHasDirectAdministrator(db, userId)) ||
      (await userHasAdministratorViaOtherGroups(db, userId, groupId));
    if (!stillAdminAfter && (await userHasAdministrator(db, userId))) {
      const n = await countAdministratorUsers(db);
      if (n <= 1) {
        const denied = lastAdministratorDenied("remove");
        throw serviceErr(denied.message, denied.status, denied.code);
      }
    }
  }
  await db
    .delete(schema.groupMembers)
    .where(
      and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, userId)),
    );
  await db
    .update(schema.groups)
    .set({ updatedAt: new Date() })
    .where(eq(schema.groups.id, groupId));
  return getGroup(db, groupId);
}

export async function assignGroupRole(
  db: Db,
  groupId: number,
  roleId: number,
): Promise<RoleRef[]> {
  await requireGroup(db, groupId);
  await requireRoleExists(db, roleId);
  try {
    await db.insert(schema.groupRoles).values({ groupId, roleId });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      // already assigned
    } else {
      throw err;
    }
  }
  await db
    .update(schema.groups)
    .set({ updatedAt: new Date() })
    .where(eq(schema.groups.id, groupId));
  return listRolesForGroup(db, groupId);
}

export async function removeGroupRole(
  db: Db,
  groupId: number,
  roleId: number,
): Promise<RoleRef[]> {
  await requireGroup(db, groupId);
  const role = await requireRoleExists(db, roleId);
  if (isAdministratorSlug(role.slug)) {
    const after = await countEffectiveAdminsExcludingGroup(db, groupId);
    // Excluding the whole group's admin grant; if group had admin, members who only
    // had admin via this group are excluded from `after`. Direct admins remain.
    // But countEffectiveAdminsExcludingGroup already excludes ALL admin via this group —
    // which is correct when removing the Administrator role from the group.
    if (after < 1) {
      const denied = lastAdministratorDenied("remove");
      throw serviceErr(denied.message, denied.status, denied.code);
    }
  }
  await db
    .delete(schema.groupRoles)
    .where(and(eq(schema.groupRoles.groupId, groupId), eq(schema.groupRoles.roleId, roleId)));
  await db
    .update(schema.groups)
    .set({ updatedAt: new Date() })
    .where(eq(schema.groups.id, groupId));
  return listRolesForGroup(db, groupId);
}

/** Roles granted to the user via any Group membership (not direct user_roles). */
export async function listRolesViaGroupsForUser(
  db: Db,
  userId: number,
): Promise<RoleRef[]> {
  const rows = await db
    .select({
      id: schema.roles.id,
      name: schema.roles.name,
      slug: schema.roles.slug,
      isSystem: schema.roles.isSystem,
    })
    .from(schema.groupMembers)
    .innerJoin(schema.groupRoles, eq(schema.groupMembers.groupId, schema.groupRoles.groupId))
    .innerJoin(schema.roles, eq(schema.groupRoles.roleId, schema.roles.id))
    .where(eq(schema.groupMembers.userId, userId));
  const byId = new Map<number, RoleRef>();
  for (const row of rows) byId.set(row.id, toRoleRef(row));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listEffectiveRolesForUser(
  db: Db,
  userId: number,
): Promise<RoleRef[]> {
  const [direct, viaGroup] = await Promise.all([
    listRolesForUser(db, userId),
    listRolesViaGroupsForUser(db, userId),
  ]);
  const byId = new Map<number, RoleRef>();
  for (const r of [...direct, ...viaGroup]) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function groupHasAdministratorRole(
  db: Db,
  groupId: number,
): Promise<boolean> {
  const roles = await listRolesForGroup(db, groupId);
  return roles.some((r) => isAdministratorSlug(r.slug));
}
