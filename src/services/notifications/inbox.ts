import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import type { NotificationType } from "../../lib/notificationSchedule.js";

type Db = NodePgDatabase<typeof schema>;

export type InboxNotification = {
  id: number;
  type: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

function present(row: typeof schema.notifications.$inferSelect): InboxNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listNotifications(
  db: Db,
  userId: number,
  limit: number,
): Promise<{ data: InboxNotification[]; unread: number }> {
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit);
  const [count] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  return { data: rows.map(present), unread: count?.count ?? 0 };
}

export async function markNotificationRead(
  db: Db,
  userId: number,
  id: number,
): Promise<InboxNotification | null> {
  const [row] = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)))
    .returning();
  return row ? present(row) : null;
}

export async function markAllNotificationsRead(db: Db, userId: number): Promise<void> {
  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
}

export async function insertInAppNotification(
  db: Db,
  input: {
    userId: number;
    type: NotificationType;
    title: string;
    body: string;
    href: string | null;
  },
): Promise<void> {
  await db.insert(schema.notifications).values({
    userId: input.userId,
    type: input.type,
    title: input.title.slice(0, 200),
    body: input.body.slice(0, 2000),
    href: input.href,
  });
}
