import { eq, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import * as schema from "../db/schema.js";
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
