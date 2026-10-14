import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import { redactSecret } from "./aiKeyMode.js";

type Db = NodePgDatabase<typeof schema>;

const LAST_ERROR_MAX = 500;

export function capStoredKeyError(message: string): string {
  const trimmed = message.trim();
  const text = trimmed || "Provider rejected the key.";
  return text.length <= LAST_ERROR_MAX ? text : text.slice(0, LAST_ERROR_MAX);
}

/**
 * Record that a stored provider key was accepted or rejected.
 * Environment fallbacks and local models are ignored.
 * Success clears `last_error` only. Rejection also clears verification.
 */
export async function noteStoredKeyUse(
  db: Db,
  args: {
    userId: number;
    pluginId: string;
    storedKey: "user" | "instance" | null;
    apiKey: string | null;
    outcome: "ok" | "auth";
    message: string;
  },
): Promise<void> {
  if (args.storedKey == null) return;
  const now = new Date();
  if (args.outcome === "ok") {
    if (args.storedKey === "user") {
      await db
        .update(schema.userAiCredentials)
        .set({ lastError: null, updatedAt: now })
        .where(
          and(
            eq(schema.userAiCredentials.userId, args.userId),
            eq(schema.userAiCredentials.pluginId, args.pluginId),
          ),
        );
      return;
    }
    await db
      .update(schema.aiInstanceCredentials)
      .set({ lastError: null, updatedAt: now })
      .where(eq(schema.aiInstanceCredentials.pluginId, args.pluginId));
    return;
  }

  const message = capStoredKeyError(redactSecret(args.message, args.apiKey ?? ""));
  if (args.storedKey === "user") {
    await db
      .update(schema.userAiCredentials)
      .set({ verifiedAt: null, lastError: message, updatedAt: now })
      .where(
        and(
          eq(schema.userAiCredentials.userId, args.userId),
          eq(schema.userAiCredentials.pluginId, args.pluginId),
        ),
      );
    return;
  }
  await db
    .update(schema.aiInstanceCredentials)
    .set({ verifiedAt: null, lastError: message, updatedAt: now })
    .where(eq(schema.aiInstanceCredentials.pluginId, args.pluginId));
}
