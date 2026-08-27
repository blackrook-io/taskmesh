import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import {
  ADMINISTRATOR_SLUG,
  isAdministratorFromRoles,
  isAdministratorSlug,
  lastAdministratorDenied,
  slugFromRoleName,
  toRoleRef,
  type RoleRef,
} from "../lib/roles.js";
import type { UserProfile } from "../lib/userFields.js";

type Db = NodePgDatabase<typeof schema>;

function serviceErr(message: string, status: number, code: string): Error {
  return Object.assign(new Error(message), { status, code });
}

export async function listRoles(db: Db): Promise<RoleRef[]> {
  const rows = await db.select().from(schema.roles).orderBy(asc(schema.roles.name));
  return rows.map(toRoleRef);
}

export async function listRolesByUserIds(
  db: Db,
  userIds: number[],
): Promise<Map<number, RoleRef[]>> {
  const map = new Map<number, RoleRef[]>();
  for (const id of userIds) map.set(id, []);
  if (userIds.length === 0) return map;

  const rows = await db
    .select({
      userId: schema.userRoles.userId,
      id: schema.roles.id,
      name: schema.roles.name,
      slug: schema.roles.slug,
      isSystem: schema.roles.isSystem,
    })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(inArray(schema.userRoles.userId, userIds));

  for (const row of rows) {
    const list = map.get(row.userId);
    if (!list) continue;
    list.push(toRoleRef(row));
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}

export async function listRolesForUser(db: Db, userId: number): Promise<RoleRef[]> {
  const map = await listRolesByUserIds(db, [userId]);
  return map.get(userId) ?? [];
}

export async function userHasAdministrator(db: Db, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(
      and(eq(schema.userRoles.userId, userId), eq(schema.roles.slug, ADMINISTRATOR_SLUG)),
    )
    .limit(1);
  return Boolean(row);
}

export async function countAdministratorUsers(db: Db): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(eq(schema.roles.slug, ADMINISTRATOR_SLUG));
  return Number(row?.value ?? 0);
}

async function assertNotLastAdministrator(
  db: Db,
  userId: number,
  action: "remove" | "delete" | "deactivate" | "lock",
): Promise<void> {
  const isAdmin = await userHasAdministrator(db, userId);
  if (!isAdmin) return;
  const n = await countAdministratorUsers(db);
  if (n <= 1) {
    const denied = lastAdministratorDenied(action);
    throw serviceErr(denied.message, denied.status, denied.code);
  }
}

export async function guardLastAdministrator(
  db: Db,
  userId: number,
  action: "delete" | "deactivate" | "lock",
): Promise<void> {
  await assertNotLastAdministrator(db, userId, action);
}

export async function attachRolesToProfile(
  db: Db,
  profile: UserProfile,
  userId: number,
): Promise<UserProfile> {
  const roles = await listRolesForUser(db, userId);
  return {
    ...profile,
    roles,
    isAdministrator: isAdministratorFromRoles(roles),
  };
}

export async function createRole(db: Db, name: string): Promise<RoleRef> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw serviceErr("Role name is required", 400, "invalid_role_name");
  }
  const slug = slugFromRoleName(trimmed);
  if (!slug) {
    throw serviceErr("Role name must include letters or digits", 400, "invalid_role_name");
  }
  if (isAdministratorSlug(slug)) {
    throw serviceErr("That role name is reserved", 409, "role_reserved");
  }
  const [dup] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.slug, slug))
    .limit(1);
  if (dup) {
    throw serviceErr("A role with that name already exists", 409, "role_taken");
  }
  const [row] = await db
    .insert(schema.roles)
    .values({ name: trimmed, slug, isSystem: false })
    .returning();
  if (!row) {
    throw serviceErr("Could not create role", 500, "create_failed");
  }
  return toRoleRef(row);
}

export async function renameRole(
  db: Db,
  roleId: number,
  name: string,
): Promise<RoleRef> {
  const role = await requireRole(db, roleId);
  if (role.isSystem) {
    throw serviceErr("Cannot rename a system role", 409, "system_role");
  }
  const trimmed = name.trim();
  if (!trimmed) {
    throw serviceErr("Role name is required", 400, "invalid_role_name");
  }
  const [row] = await db
    .update(schema.roles)
    .set({ name: trimmed })
    .where(eq(schema.roles.id, roleId))
    .returning();
  return toRoleRef(row!);
}

export async function deleteRole(db: Db, roleId: number): Promise<void> {
  const role = await requireRole(db, roleId);
  if (role.isSystem) {
    throw serviceErr("Cannot delete a system role", 409, "system_role");
  }
  await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
}

async function requireRole(db: Db, roleId: number): Promise<typeof schema.roles.$inferSelect> {
  const [row] = await db.select().from(schema.roles).where(eq(schema.roles.id, roleId)).limit(1);
  if (!row) {
    throw serviceErr("Role not found", 404, "not_found");
  }
  return row;
}

export async function assignRole(
  db: Db,
  userId: number,
  roleId: number,
): Promise<RoleRef[]> {
  await requireUserExists(db, userId);
  await requireRole(db, roleId);
  try {
    await db.insert(schema.userRoles).values({ userId, roleId });
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
  return listRolesForUser(db, userId);
}

export async function removeRole(
  db: Db,
  userId: number,
  roleId: number,
): Promise<RoleRef[]> {
  await requireUserExists(db, userId);
  const role = await requireRole(db, roleId);
  if (isAdministratorSlug(role.slug)) {
    await assertNotLastAdministrator(db, userId, "remove");
  }
  await db
    .delete(schema.userRoles)
    .where(and(eq(schema.userRoles.userId, userId), eq(schema.userRoles.roleId, roleId)));
  return listRolesForUser(db, userId);
}

async function requireUserExists(db: Db, userId: number): Promise<void> {
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!row) {
    throw serviceErr("User not found", 404, "not_found");
  }
}
