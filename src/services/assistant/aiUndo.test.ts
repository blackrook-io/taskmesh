import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  commentBodyHash,
  decideUndo,
  isWithinUndoWindow,
  journalDraftFromMutation,
  parseUndoInverse,
  runUndo,
  shouldAutoApplyTier1,
  tagIdsToDelete,
  undoAuditInput,
  type UndoInverse,
  type UndoPort,
} from "./aiUndo.js";

const day = 24 * 60 * 60 * 1000;

describe("Tier 1 auto-apply gate", () => {
  it("applies only a Tier 1 plan when the ceiling and the user both allow it", () => {
    assert.equal(shouldAutoApplyTier1(1, { tier1Enabled: true, tier1OptIn: true }), true);
    assert.equal(shouldAutoApplyTier1(1, { tier1Enabled: true, tier1OptIn: false }), false);
    assert.equal(shouldAutoApplyTier1(1, { tier1Enabled: false, tier1OptIn: true }), false);
    assert.equal(shouldAutoApplyTier1(2, { tier1Enabled: true, tier1OptIn: true }), false);
  });
});

describe("undo journal drafts", () => {
  it("journals a new tag and ignores a tag that was already there", () => {
    const created = journalDraftFromMutation({
      policyAction: "tag",
      path: "/api/v1/taggings",
      entityType: "task",
      entityId: 4,
      summary: "Add tag",
      result: { ok: true, status: 201, data: { taggingId: 9, created: true } },
    });
    assert.deepEqual(created?.inverse, { kind: "remove_tagging", taggingId: 9 });
    const duplicate = journalDraftFromMutation({
      policyAction: "tag",
      path: "/api/v1/taggings",
      entityType: "task",
      entityId: 4,
      summary: "Add tag",
      result: { ok: true, status: 200, data: { id: 3, created: false } },
    });
    assert.equal(duplicate, null);
  });

  it("journals a new link, comment, and dependency", () => {
    const link = journalDraftFromMutation({
      policyAction: "link",
      path: "/api/v1/links",
      entityType: "task",
      entityId: 1,
      summary: "Link",
      result: { ok: true, status: 201, data: { id: 12 } },
    });
    assert.deepEqual(link?.inverse, { kind: "remove_link", linkId: 12 });

    const comment = journalDraftFromMutation({
      policyAction: "comment",
      path: "/api/v1/tasks/1/activity",
      entityType: "task",
      entityId: 1,
      summary: "Comment",
      result: { ok: true, status: 201, data: { id: 5, body: "hello" } },
    });
    assert.equal(comment?.action, "comment");
    assert.deepEqual(comment?.inverse, {
      kind: "delete_comment",
      activityId: 5,
      bodyHash: commentBodyHash("hello"),
    });

    const dependency = journalDraftFromMutation({
      policyAction: "link",
      path: "/api/v1/tasks/8/dependencies",
      entityType: "task",
      entityId: 8,
      summary: "Depends on",
      result: { ok: true, status: 201, data: { created: true, dependsOnTaskId: 3 } },
    });
    assert.deepEqual(dependency?.inverse, {
      kind: "remove_dependency",
      taskId: 8,
      dependsOnTaskId: 3,
    });
  });
});

function port(inverse: UndoInverse, present: boolean, bodyHash = ""): UndoPort & { performed: UndoInverse[] } {
  const performed: UndoInverse[] = [];
  return {
    performed,
    async targetState(value) {
      if (value.kind === "delete_comment") {
        if (!present) return { kind: "delete_comment", present: false };
        return {
          kind: "delete_comment",
          present: true,
          bodyHash,
          expectedHash: value.bodyHash,
        };
      }
      if (value.kind === "remove_tagging") return { kind: "remove_tagging", present };
      if (value.kind === "remove_link") return { kind: "remove_link", present };
      return { kind: "remove_dependency", present };
    },
    async perform(value) {
      performed.push(value);
    },
  };
}

describe("undo", () => {
  const now = new Date("2026-10-12T16:00:00.000Z");
  const appliedAt = new Date(now.getTime() - day);

  it("removes the tagging, link, comment, or dependency created by the row", async () => {
    const cases: UndoInverse[] = [
      { kind: "remove_tagging", taggingId: 1 },
      { kind: "remove_link", linkId: 2 },
      { kind: "delete_comment", activityId: 3, bodyHash: commentBodyHash("note") },
      { kind: "remove_dependency", taskId: 4, dependsOnTaskId: 5 },
    ];
    for (const inverse of cases) {
      const hash = inverse.kind === "delete_comment" ? inverse.bodyHash : "";
      const fake = port(inverse, true, hash);
      const decision = await runUndo({
        status: "applied",
        appliedAt,
        now,
        windowDays: 7,
        force: false,
        skip: false,
        inverse,
        port: fake,
      });
      assert.equal(decision.action, "undo");
      assert.deepEqual(fake.performed, [inverse]);
    }
  });

  it("reports an edited comment and deletes it only when forced", async () => {
    const inverse: UndoInverse = {
      kind: "delete_comment",
      activityId: 3,
      bodyHash: commentBodyHash("original"),
    };
    const held = port(inverse, true, commentBodyHash("edited"));
    const conflict = await runUndo({
      status: "applied",
      appliedAt,
      now,
      windowDays: 7,
      force: false,
      skip: false,
      inverse,
      port: held,
    });
    assert.equal(conflict.action, "reject");
    if (conflict.action === "reject") {
      assert.equal(conflict.status, 409);
      assert.equal(conflict.change, "The comment text changed.");
      assert.equal(conflict.canForce, true);
    }
    assert.equal(held.performed.length, 0);

    const forced = port(inverse, true, commentBodyHash("edited"));
    const undone = await runUndo({
      status: "applied",
      appliedAt,
      now,
      windowDays: 7,
      force: true,
      skip: false,
      inverse,
      port: forced,
    });
    assert.equal(undone.action, "undo");
    assert.equal(forced.performed.length, 1);
  });

  it("lets a missing target be skipped and refuses to undo it", async () => {
    const inverse: UndoInverse = { kind: "remove_tagging", taggingId: 9 };
    const missing = port(inverse, false);
    const conflict = decideUndo({
      status: "applied",
      withinWindow: true,
      force: true,
      skip: false,
      target: { kind: "remove_tagging", present: false },
    });
    assert.equal(conflict.action, "reject");
    if (conflict.action === "reject") assert.equal(conflict.code, "undo_target_missing");

    const skipped = await runUndo({
      status: "applied",
      appliedAt,
      now,
      windowDays: 7,
      force: false,
      skip: true,
      inverse,
      port: missing,
    });
    assert.equal(skipped.action, "skip");
    assert.equal(missing.performed.length, 0);
  });

  it("writes an undo audit row for a completed undo", () => {
    const row = undoAuditInput({ userId: 1, entityType: "task", entityId: 4 });
    assert.equal(row.action, "undo");
    assert.equal(row.decision, "allow");
    assert.equal(row.tier, 1);
  });

  it("rejects undo past the window", () => {
    const decision = decideUndo({
      status: "applied",
      withinWindow: isWithinUndoWindow(new Date(now.getTime() - 8 * day), now, 7),
      force: false,
      skip: false,
      target: { kind: "remove_link", present: true },
    });
    assert.equal(decision.action, "reject");
    if (decision.action === "reject") assert.equal(decision.code, "undo_expired");
  });

  it("undoes a tag batch and leaves tags that were not in the batch", async () => {
    const inverse = parseUndoInverse({
      kind: "remove_taggings",
      taggingIds: [3, 4],
      createdTagIds: [9],
    });
    assert.deepEqual(inverse, { kind: "remove_taggings", taggingIds: [3, 4], createdTagIds: [9] });
    assert.deepEqual(tagIdsToDelete([9, 10], new Set([10])), [9]);
    const removed: number[] = [];
    const port: UndoPort = {
      targetState: async () => ({ kind: "remove_taggings", present: true }),
      perform: async (value) => {
        if (value.kind === "remove_taggings") removed.push(...value.taggingIds);
      },
    };
    const decision = await runUndo({
      status: "applied",
      appliedAt: now,
      now,
      windowDays: 7,
      force: false,
      skip: false,
      inverse: inverse!,
      port,
    });
    assert.equal(decision.action, "undo");
    assert.deepEqual(removed, [3, 4]);
    const gone = decideUndo({
      status: "applied",
      withinWindow: true,
      force: false,
      skip: false,
      target: { kind: "remove_taggings", present: false },
    });
    assert.equal(gone.action, "reject");
  });
});
