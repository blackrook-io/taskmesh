export const ADMINISTRATOR_SLUG = "administrator";
export const ADMINISTRATOR_NAME = "Administrator";

export type RoleRef = {
  id: number;
  name: string;
  slug: string;
  isSystem: boolean;
};

export type LastAdministratorAction = "remove" | "delete" | "deactivate" | "lock";

export type LastAdministratorDenied = {
  status: 409;
  code: "last_administrator";
  message: string;
};

const LAST_ADMIN_MESSAGES: Record<LastAdministratorAction, string> = {
  remove: "Cannot remove the last Administrator",
  delete: "Cannot delete the last Administrator",
  deactivate: "Cannot deactivate the last Administrator",
  lock: "Cannot lock the last Administrator",
};

export function isAdministratorSlug(slug: string): boolean {
  return slug === ADMINISTRATOR_SLUG;
}

export function isAdministratorFromRoles(roles: Array<{ slug: string }>): boolean {
  return roles.some((r) => isAdministratorSlug(r.slug));
}

export function toRoleRef(row: {
  id: number;
  name: string;
  slug: string;
  isSystem: boolean;
}): RoleRef {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    isSystem: row.isSystem,
  };
}

/** Lowercase hyphenated slug from a display name. Empty if nothing usable remains. */
export function slugFromRoleName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function lastAdministratorDenied(
  action: LastAdministratorAction,
): LastAdministratorDenied {
  return {
    status: 409,
    code: "last_administrator",
    message: LAST_ADMIN_MESSAGES[action],
  };
}
