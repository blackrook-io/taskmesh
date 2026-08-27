/** Whether a user may authenticate (login / session / future API-key owner checks). */
export function userCanAuthenticate(user: {
  deactivatedAt: Date | string | null;
  lockedAt: Date | string | null;
}): boolean {
  return user.deactivatedAt == null && user.lockedAt == null;
}

export type DeleteUserDenied = {
  status: number;
  code: string;
  message: string;
};

/** Server-side delete guards. Order: last remaining, self, restricted authorship. */
export function deleteUserDeniedReason(opts: {
  userCount: number;
  targetId: number;
  currentUserId: number;
  hasRestrictedAuthorship: boolean;
}): DeleteUserDenied | null {
  if (opts.userCount <= 1) {
    return {
      status: 409,
      code: "last_user",
      message: "Cannot delete the last remaining user",
    };
  }
  if (opts.targetId === opts.currentUserId) {
    return {
      status: 409,
      code: "cannot_delete_self",
      message: "Cannot delete the currently signed-in user",
    };
  }
  if (opts.hasRestrictedAuthorship) {
    return {
      status: 409,
      code: "user_has_records",
      message: "This user has authored tasks or ToDos. Deactivate them instead.",
    };
  }
  return null;
}
