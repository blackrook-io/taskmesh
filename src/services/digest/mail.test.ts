import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyDigestCounts, emptyDigestSections, type DigestItem } from "../../lib/digest.js";
import { renderStoredDigestEmail } from "./mail.js";

const baseUrl = "http://127.0.0.1:5173";

function item(patch: Partial<DigestItem> = {}): DigestItem {
  return {
    entityType: "task",
    entityId: 12,
    referenceId: "T0012",
    title: "Ship the digest",
    projectId: 4,
    alsoProjectId: null,
    reason: "Due yesterday",
    href: "/tasks?open=12",
    ...patch,
  };
}

function render(patch: Partial<Parameters<typeof renderStoredDigestEmail>[0]> = {}) {
  const sections = emptyDigestSections();
  sections.overdue = [item()];
  return renderStoredDigestEmail({
    frequency: "daily",
    periodKey: "2026-10-21",
    summary: null,
    summarySource: null,
    excludedProjects: [],
    sections,
    counts: { ...emptyDigestCounts(), overdue: 1 },
    hidden: emptyDigestCounts(),
    baseUrl,
    ...patch,
  });
}

describe("stored digest email", () => {
  it("links each record and offers a frequency change", () => {
    const mail = render();
    assert.equal(mail.headline, "Daily digest for 2026-10-21");
    assert.match(mail.text, /T0012 Ship the digest — Due yesterday/);
    assert.match(mail.text, /http:\/\/127\.0\.0\.1:5173\/tasks\?open=12/);
    assert.match(mail.text, /Change frequency: http:\/\/127\.0\.0\.1:5173\/digest/);
    assert.match(mail.html, /href="http:\/\/127\.0\.0\.1:5173\/tasks\?open=12"/);
    assert.match(mail.html, /<a href="http:\/\/127\.0\.0\.1:5173\/digest">Change frequency<\/a>/);
    assert.equal(mail.text.includes("Unsubscribe"), false);
  });

  it("escapes titles and labels a model paragraph", () => {
    const sections = emptyDigestSections();
    sections.blocked = [item({ title: `<script>alert(1)</script>`, reason: `a & b` })];
    const mail = render({
      frequency: "weekly",
      periodKey: "2026-W43",
      summary: "Three tasks are late.",
      summarySource: "model",
      sections,
      counts: { ...emptyDigestCounts(), blocked: 1 },
    });
    assert.equal(mail.headline, "Weekly digest for 2026-W43");
    assert.match(mail.html, /AI-written/);
    assert.match(mail.html, /Three tasks are late\./);
    assert.match(mail.html, /&lt;script&gt;/);
    assert.equal(mail.html.includes("<script>alert"), false);
    assert.match(mail.html, /a &amp; b/);
  });

  it("counts items past the stored list, not snoozed ones", () => {
    const hidden = emptyDigestCounts();
    hidden.overdue = 2;
    const mail = render({
      counts: { ...emptyDigestCounts(), overdue: 8 },
      hidden,
    });
    assert.match(mail.text, /and 5 more: http:\/\/127\.0\.0\.1:5173\/digest/);
    assert.match(mail.html, /and 5 more/);
  });

  it("says when the period is empty", () => {
    const mail = render({
      sections: emptyDigestSections(),
      counts: emptyDigestCounts(),
      excludedProjects: [{ name: "Private" }],
    });
    assert.match(mail.text, /Not summarized: Private/);
    assert.equal(mail.text.includes("Nothing needs attention"), false);

    const quiet = render({ sections: emptyDigestSections(), counts: emptyDigestCounts() });
    assert.match(quiet.text, /Nothing needs attention in this period\./);
  });
});
