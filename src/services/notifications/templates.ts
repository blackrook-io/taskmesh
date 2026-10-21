import type { NotificationType } from "../../lib/notificationSchedule.js";

export type RenderedNotification = {
  title: string;
  body: string;
  subject: string;
  text: string;
  html: string;
};

const TYPE_LABEL: Record<NotificationType, string> = {
  digest: "Digest",
  reminder: "Reminder",
  mention: "Mention",
  assignment: "Assignment",
};

export function notificationTypeLabel(type: NotificationType): string {
  return TYPE_LABEL[type];
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraph(text: string): string {
  return `<p>${escapeHtml(text)}</p>`;
}

function rendered(
  subject: string,
  title: string,
  body: string,
  text: string,
  html: string,
): RenderedNotification {
  return { subject, title, body, text, html };
}

/** Wrapper for a digest body supplied by the digest mail task. */
export function renderDigestNotification(input: {
  headline: string;
  text: string;
  html: string;
}): RenderedNotification {
  const headline = input.headline.trim() || "Your TaskMesh digest";
  const text = input.text.trim();
  return rendered(
    headline,
    headline,
    text || "Your digest is ready.",
    [headline, "", text].join("\n").trim(),
    `<h1>${escapeHtml(headline)}</h1>${input.html}`,
  );
}

export function renderReminderNotification(input: {
  entityLabel: string;
  title: string;
  kind: "due" | "action_by";
  whenLabel: string;
}): RenderedNotification {
  const when = input.kind === "action_by" ? "action-by" : "due";
  const subject = `Reminder: ${input.entityLabel} is ${when} ${input.whenLabel}`;
  const body = `${input.title} is ${when} ${input.whenLabel}.`;
  return rendered(subject, subject, body, `${subject}\n\n${body}`, paragraph(body));
}

export function renderMentionNotification(input: {
  entityLabel: string;
  title: string;
  sourceLabel: string;
  actorName: string;
}): RenderedNotification {
  const subject = `${input.actorName} mentioned ${input.entityLabel}`;
  const body = `${input.actorName} mentioned ${input.title} from ${input.sourceLabel}.`;
  return rendered(subject, subject, body, `${subject}\n\n${body}`, paragraph(body));
}

export function renderAssignmentNotification(input: {
  entityLabel: string;
  title: string;
  actorName: string;
}): RenderedNotification {
  const subject = `${input.actorName} assigned ${input.entityLabel} to you`;
  const body = `${input.title} is now assigned to you.`;
  return rendered(subject, subject, body, `${subject}\n\n${body}`, paragraph(body));
}
