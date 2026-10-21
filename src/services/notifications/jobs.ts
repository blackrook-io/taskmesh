import type { JobDefinition } from "../jobs/definitions.js";
import { registerJob } from "../jobs/queue.js";
import { db } from "../../db/client.js";
import { flushNotificationOutbox } from "./deliver.js";
import { scanDueReminders } from "./reminders.js";

export const JOB_NOTIFICATION_REMINDERS = "notification-reminders";
export const JOB_NOTIFICATION_OUTBOX = "notification-outbox";

const REMINDER_JOB: JobDefinition = {
  name: JOB_NOTIFICATION_REMINDERS,
  label: "Notification reminders",
  retryLimit: 3,
  retryDelaySeconds: 60,
  retryBackoff: true,
  concurrency: 1,
  policy: "short",
  expireInSeconds: 20 * 60,
  cron: "10 * * * *",
};

const OUTBOX_JOB: JobDefinition = {
  name: JOB_NOTIFICATION_OUTBOX,
  label: "Notification email outbox",
  retryLimit: 3,
  retryDelaySeconds: 60,
  retryBackoff: true,
  concurrency: 1,
  policy: "short",
  expireInSeconds: 10 * 60,
  cron: "*/10 * * * *",
};

export function registerNotificationJobs(): void {
  registerJob(REMINDER_JOB, async () => {
    await scanDueReminders(db);
  });
  registerJob(OUTBOX_JOB, async () => {
    await flushNotificationOutbox(db);
  });
}
