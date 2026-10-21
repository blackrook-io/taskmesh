import { and, eq, isNull, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import {
  emailDeliverAt,
  notificationPublicBaseUrl,
  type NotificationType,
} from "../../lib/notificationSchedule.js";
import { MailError } from "../mail/settings.js";
import { enqueueOutboundMail } from "../mail/outbound.js";
import { insertInAppNotification } from "./inbox.js";
import { preferenceFor } from "./preferences.js";
import { notificationTypeLabel, escapeHtml, renderDigestNotification } from "./templates.js";
import { ensureUnsubscribeToken } from "./unsubscribe.js";

type Db = NodePgDatabase<typeof schema>;

export type NotificationDelivery = {
  inApp: boolean;
  email: "sent" | "deferred" | "skipped";
};

export type NotificationMessage = {
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  subject: string;
  text: string;
  html: string;
  href: string | null;
};

type Recipient = {
  id: number;
  email: string | null;
  emailVerifiedAt: Date | null;
  deactivatedAt: Date | null;
  lockedAt: Date | null;
};

function mailBlocked(err: unknown): boolean {
  return err instanceof MailError && (err.code === "mail_disabled" || err.code === "mail_not_configured");
}

async function recipient(db: Db, userId: number): Promise<Recipient | null> {
  const [row] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      emailVerifiedAt: schema.users.emailVerifiedAt,
      deactivatedAt: schema.users.deactivatedAt,
      lockedAt: schema.users.lockedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return row ?? null;
}

function canEmail(user: Recipient): boolean {
  return (
    user.deactivatedAt == null &&
    user.lockedAt == null &&
    Boolean(user.email?.trim()) &&
    user.emailVerifiedAt != null
  );
}

function absoluteHref(href: string | null): string | null {
  if (!href) return null;
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  return `${notificationPublicBaseUrl()}${href.startsWith("/") ? href : `/${href}`}`;
}

export function composeOutbound(input: {
  type: NotificationType;
  text: string;
  html: string;
  href: string | null;
  unsubscribeUrl: string;
}): { text: string; html: string } {
  const open = absoluteHref(input.href);
  const label = notificationTypeLabel(input.type).toLowerCase();
  const text = [
    input.text.trim(),
    open ? `Open in TaskMesh: ${open}` : "",
    `Unsubscribe from ${label} emails: ${input.unsubscribeUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const openHtml = open
    ? `<p><a href="${escapeHtml(open)}">Open in TaskMesh</a></p>`
    : "";
  const html = `${input.html}${openHtml}<p><a href="${escapeHtml(input.unsubscribeUrl)}">Unsubscribe</a> from ${escapeHtml(label)} emails.</p>`;
  return { text, html };
}

async function queueEmail(
  db: Db,
  input: NotificationMessage,
  user: Recipient,
): Promise<"sent" | "deferred"> {
  const token = await ensureUnsubscribeToken(db, user.id, input.type);
  const unsubscribeUrl = `${notificationPublicBaseUrl()}/unsubscribe?token=${encodeURIComponent(token)}`;
  const composed = composeOutbound({
    type: input.type,
    text: input.text,
    html: input.html,
    href: input.href,
    unsubscribeUrl,
  });
  const to = user.email!.trim();
  try {
    await enqueueOutboundMail(db, {
      to,
      subject: input.subject.slice(0, 500),
      text: composed.text,
      html: composed.html,
      kind: "outbound",
    });
    return "sent";
  } catch (err) {
    if (!mailBlocked(err)) {
      console.error("[notifications] mail queue", err);
    }
    return "deferred";
  }
}

async function deferEmail(db: Db, input: NotificationMessage, deliverAfter: Date): Promise<void> {
  await db.insert(schema.notificationOutbox).values({
    userId: input.userId,
    type: input.type,
    subject: input.subject.slice(0, 500),
    textBody: input.text,
    htmlBody: input.html,
    href: input.href,
    deliverAfter,
  });
}

/**
 * Write the in-app form immediately when that channel is on.
 * Email is immediate, delayed for quiet hours or a daily/weekly slot, or skipped.
 */
export async function deliverNotification(
  db: Db,
  input: NotificationMessage,
): Promise<NotificationDelivery> {
  const user = await recipient(db, input.userId);
  if (!user || user.deactivatedAt || user.lockedAt) {
    return { inApp: false, email: "skipped" };
  }
  const prefs = await preferenceFor(db, input.userId, input.type);
  let inApp = false;
  if (prefs.inApp) {
    await insertInAppNotification(db, input);
    inApp = true;
  }
  if (!prefs.email || !canEmail(user)) {
    return { inApp, email: "skipped" };
  }
  const deliverAt = emailDeliverAt(new Date(), prefs);
  if (deliverAt) {
    await deferEmail(db, input, deliverAt);
    return { inApp, email: "deferred" };
  }
  const queued = await queueEmail(db, input, user);
  if (queued === "deferred") {
    await deferEmail(db, input, new Date());
  }
  return { inApp, email: queued };
}

/** Send due outbox rows. Leaves a row in place when outbound mail is not ready. */
export async function flushNotificationOutbox(db: Db): Promise<number> {
  const now = new Date();
  const rows = await db
    .select()
    .from(schema.notificationOutbox)
    .where(and(isNull(schema.notificationOutbox.sentAt), lte(schema.notificationOutbox.deliverAfter, now)))
    .limit(25);
  let sent = 0;
  for (const row of rows) {
    const type = row.type;
    if (type !== "digest" && type !== "reminder" && type !== "mention" && type !== "assignment") {
      continue;
    }
    const user = await recipient(db, row.userId);
    const prefs = await preferenceFor(db, row.userId, type);
    if (!user || !canEmail(user) || !prefs.email) {
      await db.delete(schema.notificationOutbox).where(eq(schema.notificationOutbox.id, row.id));
      continue;
    }
    const queued = await queueEmail(db, {
      userId: row.userId,
      type,
      title: row.subject,
      body: row.textBody,
      subject: row.subject,
      text: row.textBody,
      html: row.htmlBody,
      href: row.href,
    }, user);
    if (queued !== "sent") continue;
    await db
      .update(schema.notificationOutbox)
      .set({ sentAt: new Date() })
      .where(eq(schema.notificationOutbox.id, row.id));
    sent += 1;
  }
  return sent;
}

/** Entry point for digest email (T0218). This does not build the digest. */
export async function deliverDigestNotification(
  db: Db,
  input: { userId: number; headline: string; text: string; html: string; href: string | null },
): Promise<NotificationDelivery> {
  const rendered = renderDigestNotification(input);
  return deliverNotification(db, {
    userId: input.userId,
    type: "digest",
    title: rendered.title,
    body: rendered.body,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    href: input.href,
  });
}
