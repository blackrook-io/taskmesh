import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import {
  NOTIFICATION_TYPES,
  type NotificationFrequency,
  type NotificationType,
  isValidTimeZone,
} from "../../lib/notificationSchedule.js";

type Db = NodePgDatabase<typeof schema>;

export type NotificationPreference = {
  type: NotificationType;
  inApp: boolean;
  email: boolean;
  frequency: NotificationFrequency;
  quietStart: number | null;
  quietEnd: number | null;
  timeZone: string;
};

export function defaultNotificationPreference(type: NotificationType): NotificationPreference {
  return {
    type,
    inApp: true,
    email: true,
    frequency: "immediate",
    quietStart: null,
    quietEnd: null,
    timeZone: "UTC",
  };
}

function fromRow(
  type: NotificationType,
  row: typeof schema.notificationPreferences.$inferSelect | undefined,
): NotificationPreference {
  if (!row) return defaultNotificationPreference(type);
  const frequency = row.frequency;
  const known =
    frequency === "immediate" || frequency === "daily" || frequency === "weekly"
      ? frequency
      : "immediate";
  return {
    type,
    inApp: row.inApp,
    email: row.email,
    frequency: known,
    quietStart: row.quietStart,
    quietEnd: row.quietEnd,
    timeZone: row.timeZone,
  };
}

export async function listNotificationPreferences(
  db: Db,
  userId: number,
): Promise<NotificationPreference[]> {
  const rows = await db
    .select()
    .from(schema.notificationPreferences)
    .where(eq(schema.notificationPreferences.userId, userId));
  const byType = new Map(rows.map((row) => [row.type, row]));
  return NOTIFICATION_TYPES.map((type) => fromRow(type, byType.get(type)));
}

export async function preferenceFor(
  db: Db,
  userId: number,
  type: NotificationType,
): Promise<NotificationPreference> {
  const [row] = await db
    .select()
    .from(schema.notificationPreferences)
    .where(
      and(
        eq(schema.notificationPreferences.userId, userId),
        eq(schema.notificationPreferences.type, type),
      ),
    );
  return fromRow(type, row);
}

export function preferenceError(message: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status: 400, code: "validation_error" });
}

export function assertPreference(input: NotificationPreference): void {
  if (!isValidTimeZone(input.timeZone)) {
    throw preferenceError("Time zone is not recognized.");
  }
  const start = input.quietStart;
  const end = input.quietEnd;
  const missing = start == null && end == null;
  const pair =
    start != null &&
    end != null &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    start <= 23 &&
    end >= 0 &&
    end <= 23 &&
    start !== end;
  if (!missing && !pair) {
    throw preferenceError("Quiet hours need a start and an end hour, and they must differ.");
  }
}

export async function saveNotificationPreferences(
  db: Db,
  userId: number,
  items: NotificationPreference[],
): Promise<NotificationPreference[]> {
  const seen = new Set<NotificationType>();
  for (const item of items) {
    if (seen.has(item.type)) throw preferenceError("Each notification type is listed once.");
    seen.add(item.type);
    assertPreference(item);
  }
  if (seen.size !== NOTIFICATION_TYPES.length) {
    throw preferenceError("Save all four notification types together.");
  }
  const now = new Date();
  for (const item of items) {
    await db
      .insert(schema.notificationPreferences)
      .values({
        userId,
        type: item.type,
        inApp: item.inApp,
        email: item.email,
        frequency: item.frequency,
        quietStart: item.quietStart,
        quietEnd: item.quietEnd,
        timeZone: item.timeZone,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.notificationPreferences.userId, schema.notificationPreferences.type],
        set: {
          inApp: item.inApp,
          email: item.email,
          frequency: item.frequency,
          quietStart: item.quietStart,
          quietEnd: item.quietEnd,
          timeZone: item.timeZone,
          updatedAt: now,
        },
      });
  }
  return listNotificationPreferences(db, userId);
}

export async function disableEmailForType(
  db: Db,
  userId: number,
  type: NotificationType,
): Promise<void> {
  const items = await listNotificationPreferences(db, userId);
  await saveNotificationPreferences(
    db,
    userId,
    items.map((item) => (item.type === type ? { ...item, email: false } : item)),
  );
}
