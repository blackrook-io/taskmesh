import type { RoleRef } from "./roles.js";

/** Display form: U + zero-padded number (at least 4 digits). */
export function formatUserNumber(n: number): string {
  return `U${String(n).padStart(4, "0")}`;
}

export type UserRef = {
  id: number;
  referenceId: string;
  displayName: string;
};

export type UserProfile = UserRef & {
  email: string | null;
  avatarUploadId: number | null;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  lastApiAt: string | null;
  /** True when a password hash is stored; never exposes the secret. */
  hasPassword: boolean;
  roles: RoleRef[];
  isAdministrator: boolean;
};

export function toUserRef(user: {
  id: number;
  number: number;
  displayName: string;
}): UserRef {
  return {
    id: user.id,
    referenceId: formatUserNumber(user.number),
    displayName: user.displayName,
  };
}

export function avatarUrlFromStoredName(storedName: string | null | undefined): string | null {
  if (!storedName) return null;
  return `/api/v1/files/${encodeURIComponent(storedName)}`;
}

export function toUserProfile(
  user: {
    id: number;
    number: number;
    displayName: string;
    email: string | null;
    avatarUploadId: number | null;
    lastLoginAt: Date | null;
    lastApiAt: Date | null;
    passwordHash?: string | null;
  },
  avatarStoredName?: string | null,
): UserProfile {
  return {
    ...toUserRef(user),
    email: user.email,
    avatarUploadId: user.avatarUploadId,
    avatarUrl: avatarUrlFromStoredName(avatarStoredName),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    lastApiAt: user.lastApiAt?.toISOString() ?? null,
    hasPassword: Boolean(user.passwordHash),
    roles: [],
    isAdministrator: false,
  };
}
