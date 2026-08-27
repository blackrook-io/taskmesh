export const ADMINISTRATOR_SLUG = "administrator";

export type RoleRef = {
  id: number;
  name: string;
  slug: string;
  isSystem: boolean;
};

export function userIsAdministrator(
  user: { isAdministrator?: boolean; roles?: Array<{ slug: string }> } | null | undefined,
): boolean {
  if (!user) return false;
  if (user.isAdministrator) return true;
  return user.roles?.some((r) => r.slug === ADMINISTRATOR_SLUG) ?? false;
}

export function roleIsAdministrator(role: { slug: string }): boolean {
  return role.slug === ADMINISTRATOR_SLUG;
}
