import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import type { NotificationType } from "../../lib/notificationSchedule.js";
import { disableEmailForType } from "./preferences.js";

type Db = NodePgDatabase<typeof schema>;

export async function ensureUnsubscribeToken(
  db: Db,
  userId: number,
  type: NotificationType,
): Promise<string> {
  const [existing] = await db
    .select({ token: schema.notificationUnsubscribeTokens.token })
    .from(schema.notificationUnsubscribeTokens)
    .where(
      and(
        eq(schema.notificationUnsubscribeTokens.userId, userId),
        eq(schema.notificationUnsubscribeTokens.type, type),
      ),
    );
  if (existing) return existing.token;
  const token = randomBytes(32).toString("base64url");
  const [inserted] = await db
    .insert(schema.notificationUnsubscribeTokens)
    .values({ userId, type, token })
    .onConflictDoNothing({
      target: [
        schema.notificationUnsubscribeTokens.userId,
        schema.notificationUnsubscribeTokens.type,
      ],
    })
    .returning({ token: schema.notificationUnsubscribeTokens.token });
  if (inserted) return inserted.token;
  const [stored] = await db
    .select({ token: schema.notificationUnsubscribeTokens.token })
    .from(schema.notificationUnsubscribeTokens)
    .where(
      and(
        eq(schema.notificationUnsubscribeTokens.userId, userId),
        eq(schema.notificationUnsubscribeTokens.type, type),
      ),
    );
  if (!stored) throw new Error("Could not store unsubscribe token");
  return stored.token;
}

export async function unsubscribeByToken(
  db: Db,
  token: string,
): Promise<{ type: NotificationType } | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const [row] = await db
    .select()
    .from(schema.notificationUnsubscribeTokens)
    .where(eq(schema.notificationUnsubscribeTokens.token, trimmed));
  if (!row) return null;
  const type = row.type;
  if (type !== "digest" && type !== "reminder" && type !== "mention" && type !== "assignment") {
    return null;
  }
  await disableEmailForType(db, row.userId, type);
  return { type };
}
