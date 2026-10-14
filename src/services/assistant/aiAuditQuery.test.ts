import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db, pool } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { adminRouter } from "../../routes/v1/admin.js";
import {
  AI_AUDIT_EXPORT_CAP,
  aiAuditRowsToCsv,
  listAiAudit,
  parseAiAuditListQuery,
  parseAuditDay,
  type AiAuditListRow,
} from "./aiAuditQuery.js";

const started = new Date();
const feature = `t0189-audit-${started.getTime()}`;

describe("AI audit query", { concurrency: false }, () => {
  after(async () => {
    await db.delete(schema.aiAuditLog).where(eq(schema.aiAuditLog.feature, feature));
    await pool.end();
  });

  it("treats the To date as the end of that UTC day", () => {
    assert.equal(parseAuditDay("2026-01-31", true)?.toISOString(), "2026-02-01T00:00:00.000Z");
    assert.equal(parseAuditDay("2026-01-31", false)?.toISOString(), "2026-01-31T00:00:00.000Z");
  });

  it("caps an export and keeps the decision filter", () => {
    const parsed = parseAiAuditListQuery(
      { limit: "10", offset: "20", decision: "deny", from: "2026-01-01", to: "2026-01-05" },
      { export: true },
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.query.limit, AI_AUDIT_EXPORT_CAP);
    assert.equal(parsed.query.offset, 0);
    assert.equal(parsed.query.decision, "deny");
    assert.equal(parsed.query.from?.toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(parsed.query.toExclusive?.toISOString(), "2026-01-06T00:00:00.000Z");
  });

  it("escapes a formula and a comma in the CSV", () => {
    const row: AiAuditListRow = {
      id: 1,
      createdAt: "2026-01-02T00:00:00.000Z",
      userName: "Rook, Admin",
      feature: "admin",
      action: "settings",
      decision: "allow",
      tier: 0,
      reason: "=webFetch",
      record: null,
      projectName: null,
    };
    const csv = aiAuditRowsToCsv([row]);
    assert.match(csv, /'=webFetch/);
    assert.match(csv, /"Rook, Admin"/);
  });

  it("filters by decision and date", async () => {
    await db.insert(schema.aiAuditLog).values([
      {
        feature,
        action: "settings",
        decision: "allow",
        tier: 0,
        reason: "webFetch true",
        createdAt: new Date("2026-01-02T12:00:00.000Z"),
      },
      {
        feature,
        action: "settings",
        decision: "deny",
        tier: 3,
        reason: "floor",
        createdAt: new Date("2026-01-10T12:00:00.000Z"),
      },
    ]);
    const early = parseAiAuditListQuery({ feature, from: "2026-01-01", to: "2026-01-05" });
    assert.equal(early.ok, true);
    if (!early.ok) return;
    const earlyRows = await listAiAudit(db, early.query);
    assert.equal(earlyRows.length, 1);
    assert.equal(earlyRows[0]?.decision, "allow");
    assert.doesNotMatch(earlyRows[0]?.reason ?? "", /sk-/);

    const denied = parseAiAuditListQuery({ feature, decision: "deny" });
    assert.equal(denied.ok, true);
    if (!denied.ok) return;
    const deniedRows = await listAiAudit(db, denied.query);
    assert.equal(deniedRows.length, 1);
    assert.equal(deniedRows[0]?.decision, "deny");
  });

  it("mounts the audit routes behind the administrator gate", () => {
    const stack = (
      adminRouter as unknown as {
        stack: Array<{ name?: string; route?: { path?: string } }>;
      }
    ).stack;
    assert.equal(stack[0]?.name, "requireAdministrator");
    const paths = stack.flatMap((layer) => (layer.route?.path ? [layer.route.path] : []));
    assert.ok(paths.includes("/ai/audit"));
    assert.ok(paths.includes("/ai/audit/export"));
    assert.ok(paths.includes("/system-properties"));
  });
});
