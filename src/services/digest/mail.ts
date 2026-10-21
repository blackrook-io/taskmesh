import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import {
  DIGEST_SECTIONS,
  isDigestSection,
  readDigestCounts,
  readDigestSections,
  readExcludedProjects,
  type DigestCounts,
  type DigestFrequency,
  type DigestItem,
  type DigestSections,
} from "../../lib/digest.js";
import { applyDigestHides, type DigestHide } from "../../lib/digestHides.js";
import { notificationPublicBaseUrl } from "../../lib/notificationSchedule.js";
import { deliverDigestNotification } from "../notifications/deliver.js";
import { escapeHtml } from "../notifications/templates.js";

type Db = NodePgDatabase<typeof schema>;

const SECTION_LABELS: Record<(typeof DIGEST_SECTIONS)[number], string> = {
  overdue: "Overdue",
  at_risk: "At risk",
  stale: "Stale",
  blocked: "Blocked",
  changed: "Changed",
  suggestions: "Suggestions",
  duplicates: "Duplicates",
  assigned_out: "Assigned to others",
};

export type DigestMailBody = {
  headline: string;
  text: string;
  html: string;
};

function absoluteUrl(baseUrl: string, href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  const base = baseUrl.replace(/\/$/, "");
  return `${base}${href.startsWith("/") ? href : `/${href}`}`;
}

function itemLine(item: DigestItem, baseUrl: string): { text: string; html: string } {
  const label = `${item.referenceId} ${item.title}`.trim();
  const url = absoluteUrl(baseUrl, item.href);
  return {
    text: `- ${label} — ${item.reason}\n  ${url}`,
    html: `<li><a href="${escapeHtml(url)}">${escapeHtml(label)}</a> — ${escapeHtml(item.reason)}</li>`,
  };
}

/**
 * Body of a stored digest email. Unsubscribe is added later by notification delivery.
 * `sections` are the items to list. `hidden` counts items omitted for snooze or dismiss.
 */
export function renderStoredDigestEmail(input: {
  frequency: DigestFrequency;
  periodKey: string;
  summary: string | null;
  summarySource: "model" | null;
  excludedProjects: { name: string }[];
  sections: DigestSections;
  counts: DigestCounts;
  hidden: DigestCounts;
  baseUrl: string;
}): DigestMailBody {
  const cadence = input.frequency === "weekly" ? "Weekly" : "Daily";
  const headline = `${cadence} digest for ${input.periodKey}`;
  const digestUrl = absoluteUrl(input.baseUrl, "/digest");
  const textParts: string[] = [];
  const htmlParts: string[] = [];

  const summary = input.summary?.trim() ?? "";
  if (summary) {
    if (input.summarySource === "model") {
      textParts.push("AI-written");
      htmlParts.push(`<p><strong>AI-written</strong></p>`);
    }
    textParts.push(summary);
    htmlParts.push(`<p>${escapeHtml(summary)}</p>`);
  }

  const excluded = input.excludedProjects.map((project) => project.name.trim()).filter(Boolean);
  if (excluded.length > 0) {
    const line = `Not summarized: ${excluded.join(", ")}`;
    textParts.push(line);
    htmlParts.push(`<p>${escapeHtml(line)}</p>`);
  }

  let wroteSection = false;
  for (const section of DIGEST_SECTIONS) {
    const items = input.sections[section];
    const more = Math.max(0, input.counts[section] - items.length - input.hidden[section]);
    if (items.length === 0 && more === 0) continue;
    wroteSection = true;
    const label = SECTION_LABELS[section];
    const lines = items.map((item) => itemLine(item, input.baseUrl));
    const text = [label, ...lines.map((line) => line.text)];
    const html = [`<h2>${escapeHtml(label)}</h2>`];
    if (lines.length > 0) {
      html.push("<ul>", ...lines.map((line) => line.html), "</ul>");
    }
    if (more > 0) {
      text.push(`and ${more} more: ${digestUrl}`);
      html.push(`<p>and ${more} more — <a href="${escapeHtml(digestUrl)}">open the digest</a></p>`);
    }
    textParts.push(text.join("\n"));
    htmlParts.push(html.join(""));
  }

  if (!summary && !wroteSection && excluded.length === 0) {
    const line = "Nothing needs attention in this period.";
    textParts.push(line);
    htmlParts.push(`<p>${escapeHtml(line)}</p>`);
  }

  textParts.push(`Change frequency: ${digestUrl}`);
  htmlParts.push(`<p><a href="${escapeHtml(digestUrl)}">Change frequency</a></p>`);

  return {
    headline,
    text: textParts.join("\n\n"),
    html: htmlParts.join(""),
  };
}

function toHide(row: typeof schema.digestItemHides.$inferSelect): DigestHide | null {
  if (!isDigestSection(row.section)) return null;
  if (row.kind !== "snooze" && row.kind !== "dismiss") return null;
  return {
    entityType: row.entityType,
    entityId: row.entityId,
    section: row.section,
    kind: row.kind,
    periodKey: row.periodKey,
    until: row.until ? row.until.toISOString() : null,
  };
}

/** Hand one stored digest to notification delivery. A later retry does not send it again. */
export async function deliverStoredDigest(db: Db, userId: number, digestId: number): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.attentionDigests)
    .where(and(eq(schema.attentionDigests.id, digestId), eq(schema.attentionDigests.userId, userId)))
    .limit(1);
  if (!row || row.emailedAt) return;

  const hideRows = await db
    .select()
    .from(schema.digestItemHides)
    .where(eq(schema.digestItemHides.userId, userId));
  const applied = applyDigestHides({
    sections: readDigestSections(row.sections),
    hides: hideRows.flatMap((hide) => {
      const parsed = toHide(hide);
      return parsed ? [parsed] : [];
    }),
    periodKey: row.periodKey,
    now: new Date(),
  });
  const frequency: DigestFrequency = row.frequency === "weekly" ? "weekly" : "daily";
  const rendered = renderStoredDigestEmail({
    frequency,
    periodKey: row.periodKey,
    summary: row.summary,
    summarySource: row.summarySource === "model" ? "model" : null,
    excludedProjects: readExcludedProjects(row.excludedProjects),
    sections: applied.sections,
    counts: readDigestCounts(row.counts),
    hidden: applied.hidden,
    baseUrl: notificationPublicBaseUrl(),
  });
  await deliverDigestNotification(db, {
    userId,
    headline: rendered.headline,
    text: rendered.text,
    html: rendered.html,
    href: "/digest",
  });
  await db
    .update(schema.attentionDigests)
    .set({ emailedAt: new Date() })
    .where(and(eq(schema.attentionDigests.id, row.id), isNull(schema.attentionDigests.emailedAt)));
}
