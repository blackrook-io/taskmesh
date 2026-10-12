import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db, pool } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { AiFeedbackError, recordAiFeedback, summarizeQuality } from "./aiFeedback.js";

describe("summarizeQuality", () => {
  it("computes rates and omits a rate when the denominator is zero", () => {
    const groups = summarizeQuality([
      { feature: "assistant", model: "gpt-test", kind: "thumb_up", count: 3 },
      { feature: "assistant", model: "gpt-test", kind: "thumb_down", count: 1 },
      { feature: "assistant", model: "gpt-test", kind: "accept", count: 2 },
      { feature: "assistant", model: "gpt-test", kind: "dismiss", count: 2 },
      { feature: "assistant", model: "gpt-test", kind: "undo", count: 1 },
      { feature: "tagging", model: null, kind: "thumb_up", count: 1 },
    ]);
    const assistant = groups.find((group) => group.feature === "assistant");
    assert.equal(assistant?.thumbUpRate, 0.75);
    assert.equal(assistant?.acceptRate, 0.5);
    assert.equal(assistant?.undoRate, 0.5);
    const tagging = groups.find((group) => group.feature === "tagging");
    assert.equal(tagging?.acceptRate, null);
    assert.equal(tagging?.undoRate, null);
    assert.equal(tagging?.thumbUpRate, 1);
  });
});

describe("recordAiFeedback", () => {
  const auditIds: number[] = [];

  after(async () => {
    for (const id of auditIds) {
      await db.delete(schema.aiAuditLog).where(eq(schema.aiAuditLog.id, id));
    }
    await pool.end();
  });

  async function auditFor(userId: number): Promise<number> {
    const [row] = await db
      .insert(schema.aiAuditLog)
      .values({
        userId,
        feature: "assistant",
        provider: "stub",
        model: "gpt-test",
        action: "respond",
        decision: "allow",
        tier: 0,
        reason: "test",
      })
      .returning({ id: schema.aiAuditLog.id });
    if (!row) throw new Error("audit insert failed");
    auditIds.push(row.id);
    return row.id;
  }

  it("replaces a thumb and ignores a repeated accept", async () => {
    const auditId = await auditFor(1);
    const up = await recordAiFeedback(db, {
      auditId,
      actorUserId: 1,
      isAdministrator: false,
      kind: "thumb_up",
      note: "clear",
    });
    const down = await recordAiFeedback(db, {
      auditId,
      actorUserId: 1,
      isAdministrator: false,
      kind: "thumb_down",
      note: "missed the task",
    });
    assert.equal(down.id, up.id);
    assert.equal(down.kind, "thumb_down");
    assert.equal(down.note, "missed the task");

    const accept = await recordAiFeedback(db, {
      auditId,
      actorUserId: 1,
      isAdministrator: false,
      kind: "accept",
    });
    const again = await recordAiFeedback(db, {
      auditId,
      actorUserId: 1,
      isAdministrator: false,
      kind: "accept",
    });
    assert.equal(again.created, false);
    assert.equal(again.id, accept.id);
  });

  it("rejects feedback on another user's audit row", async () => {
    const auditId = await auditFor(1);
    await assert.rejects(
      () =>
        recordAiFeedback(db, {
          auditId,
          actorUserId: 999_999,
          isAdministrator: false,
          kind: "thumb_up",
        }),
      (err: unknown) => err instanceof AiFeedbackError && err.status === 403,
    );
  });
});
