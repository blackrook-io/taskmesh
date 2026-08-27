import { desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { verifyPassword } from "../lib/password.js";

type Db = NodePgDatabase<typeof schema>;

/** Prior hashes kept in `password_history` (current lives on `users`). */
export const PRIOR_HISTORY_LIMIT = 4;

/** Total passwords that cannot be reused: current + prior history. */
export const PASSWORD_REUSE_WINDOW = PRIOR_HISTORY_LIMIT + 1;

export const PASSWORD_REUSED_CODE = "password_reused";
export const PASSWORD_REUSED_MESSAGE =
  "Choose a password you have not used recently.";

export const INVALID_CURRENT_PASSWORD_CODE = "invalid_current_password";
export const INVALID_CURRENT_PASSWORD_MESSAGE = "Current password is incorrect.";

function serviceErr(message: string, status: number, code: string): Error {
  return Object.assign(new Error(message), { status, code });
}

/** True when plaintext matches any of the stored scrypt hashes. */
export async function passwordMatchesAnyHash(
  password: string,
  hashes: Array<string | null | undefined>,
): Promise<boolean> {
  for (const hash of hashes) {
    if (!hash) continue;
    if (await verifyPassword(password, hash)) return true;
  }
  return false;
}

/**
 * Reject when the new password matches the current hash or any prior history
 * hash (last {@link PASSWORD_REUSE_WINDOW} passwords).
 */
export async function assertPasswordNotReused(
  password: string,
  currentHash: string | null | undefined,
  priorHashes: string[],
): Promise<void> {
  const reused = await passwordMatchesAnyHash(password, [
    currentHash,
    ...priorHashes,
  ]);
  if (reused) {
    throw serviceErr(PASSWORD_REUSED_MESSAGE, 400, PASSWORD_REUSED_CODE);
  }
}

/** Newest-first prior hashes for a user (capped at {@link PRIOR_HISTORY_LIMIT}). */
export async function listPriorPasswordHashes(
  db: Db,
  userId: number,
): Promise<string[]> {
  const rows = await db
    .select({ passwordHash: schema.passwordHistory.passwordHash })
    .from(schema.passwordHistory)
    .where(eq(schema.passwordHistory.userId, userId))
    .orderBy(desc(schema.passwordHistory.createdAt), desc(schema.passwordHistory.id))
    .limit(PRIOR_HISTORY_LIMIT);
  return rows.map((r) => r.passwordHash);
}

/**
 * Push the current password hash into history and trim to
 * {@link PRIOR_HISTORY_LIMIT} newest rows. No-op when there is no current hash.
 */
export async function archiveCurrentPasswordHash(
  db: Db,
  userId: number,
  currentHash: string | null | undefined,
): Promise<void> {
  if (!currentHash) return;

  await db.insert(schema.passwordHistory).values({
    userId,
    passwordHash: currentHash,
  });

  const newestFirst = await db
    .select({ id: schema.passwordHistory.id })
    .from(schema.passwordHistory)
    .where(eq(schema.passwordHistory.userId, userId))
    .orderBy(desc(schema.passwordHistory.createdAt), desc(schema.passwordHistory.id));

  const toDelete = historyIdsToDelete(
    newestFirst.map((r) => r.id),
    PRIOR_HISTORY_LIMIT,
  );
  await deletePasswordHistoryByIds(db, toDelete);
}

/**
 * Ids among `rows` (newest-first) that fall outside the keep window.
 * Exported for unit tests.
 */
export function historyIdsToDelete(
  newestFirstIds: number[],
  keep = PRIOR_HISTORY_LIMIT,
): number[] {
  if (newestFirstIds.length <= keep) return [];
  return newestFirstIds.slice(keep);
}

/** Drop older history rows by id list (test helper / alternate trim path). */
export async function deletePasswordHistoryByIds(
  db: Db,
  ids: number[],
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .delete(schema.passwordHistory)
    .where(inArray(schema.passwordHistory.id, ids));
}
