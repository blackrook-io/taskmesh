import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { check, tierForAction } from "./aiPolicy.js";
import {
  AI_DELETE_DENY_REASON,
  classifyChangePlan,
  classifyOperation,
  defaultAiPermissionSettings,
  isAiDeleteProposal,
  operationFromProposal,
  parseStoredAiPermissionTiers,
  type AiPermissionSettings,
  type TierOperation,
} from "./aiTiers.js";

function op(over: Partial<TierOperation> = {}): TierOperation {
  return {
    action: "read",
    actorUserId: 1,
    ...over,
  };
}

function withSettings(over: Partial<AiPermissionSettings> = {}): AiPermissionSettings {
  return { ...defaultAiPermissionSettings(), ...over };
}

describe("classifyOperation", () => {
  it("assigns the default tier for each action", () => {
    const expected = [
      ["read", 0],
      ["web_fetch", 0],
      ["link", 2],
      ["tag", 2],
      ["comment", 2],
      ["propose_create", 2],
      ["propose_update", 2],
      ["apply", 2],
      ["propose_delete", 3],
      ["bulk", 3],
    ] as const;
    for (const [action, tier] of expected) {
      const result = classifyOperation(op({ action }));
      assert.equal(result.tier, tier, action);
      assert.equal(result.decision, "allow", action);
    }
  });

  it("keeps the administrator default of 1 for link, tag, and comment before opt-in", () => {
    assert.equal(tierForAction("link"), 1);
    assert.equal(tierForAction("tag"), 1);
    assert.equal(tierForAction("comment"), 1);
  });

  it("ignores a caller-supplied tier", () => {
    const result = classifyOperation(
      op({ action: "propose_delete", entityType: "task", tier: 0, fields: { tier: 0 } }),
    );
    assert.equal(result.tier, 3);
    assert.equal(result.decision, "allow");
  });

  it("treats an unknown action as tier 3", () => {
    const result = classifyOperation(op({ action: "explode" }));
    assert.equal(result.tier, 3);
    assert.equal(result.reason, "Unknown action");
  });

  it("uses an entity-type override before the action default", () => {
    const settings = withSettings({
      matrix: { ...defaultAiPermissionSettings().matrix, "tag:task": 3 },
      tier1OptIn: true,
    });
    assert.equal(classifyOperation(op({ action: "tag", entityType: "task" }), settings).tier, 3);
    assert.equal(classifyOperation(op({ action: "tag", entityType: "idea" }), settings).tier, 1);
  });

  it("requires opt-in before a tier 1 action stays at tier 1", () => {
    const enabled = withSettings({ tier1Enabled: true, tier1OptIn: true });
    const optedOut = withSettings({ tier1Enabled: true, tier1OptIn: false });
    const disabled = withSettings({ tier1Enabled: false, tier1OptIn: true });
    assert.equal(classifyOperation(op({ action: "comment" }), enabled).tier, 1);
    assert.equal(classifyOperation(op({ action: "comment" }), optedOut).tier, 2);
    assert.equal(classifyOperation(op({ action: "comment" }), disabled).tier, 2);
  });

  it("lets a user raise a tier and ignores a lower override", () => {
    const raised = withSettings({ userOverrides: { apply: 3 } });
    const lowered = withSettings({ userOverrides: { apply: 0 } });
    assert.equal(classifyOperation(op({ action: "apply" }), raised).tier, 3);
    assert.equal(classifyOperation(op({ action: "apply" }), lowered).tier, 2);
  });

  it("escalates reassignment, another user's record, and a cross-project move", () => {
    const reassignment = classifyOperation(
      op({ action: "propose_update", entityType: "task", fields: { assigneeId: 9 } }),
    );
    assert.equal(reassignment.tier, 3);
    assert.match(reassignment.reason, /Reassignment/);

    const other = classifyOperation(
      op({ action: "propose_update", entityType: "task", targetOwnerId: 4 }),
    );
    assert.equal(other.tier, 3);
    assert.match(other.reason, /Another user's record/);

    const sameOwner = classifyOperation(
      op({ action: "propose_update", entityType: "task", targetOwnerId: 1 }),
    );
    assert.equal(sameOwner.tier, 2);

    const move = classifyOperation(
      op({
        action: "propose_update",
        entityType: "task",
        projectId: 1,
        fields: { projectId: 2 },
      }),
    );
    assert.equal(move.tier, 3);
    assert.match(move.reason, /Cross-project/);

    const createInProject = classifyOperation(
      op({ action: "propose_create", entityType: "task", fields: { projectId: 2 } }),
    );
    assert.equal(createInProject.tier, 2);
  });
});

describe("classifyChangePlan", () => {
  it("uses the highest operation tier", () => {
    const plan = classifyChangePlan([
      op({ action: "read" }),
      op({ action: "propose_create", entityType: "idea" }),
    ]);
    assert.equal(plan.tier, 2);
    assert.deepEqual(plan.escalations, []);
  });

  it("is tier 0 when the turn proposes nothing", () => {
    const plan = classifyChangePlan([]);
    assert.equal(plan.tier, 0);
  });

  it("escalates when the record count passes the threshold", () => {
    const operations = Array.from({ length: 6 }, () =>
      op({ action: "propose_create", entityType: "task" }),
    );
    const plan = classifyChangePlan(operations);
    assert.equal(plan.tier, 3);
    assert.match(plan.escalations.join(" "), /Record count 6 exceeds the limit of 5/);
  });

  it("counts repeated edits of one record once", () => {
    const operations = [
      op({ action: "propose_update", entityType: "task", entityId: 8, projectId: 1 }),
      op({ action: "propose_update", entityType: "task", entityId: 8, projectId: 1 }),
    ];
    const plan = classifyChangePlan(operations, withSettings({ maxRecords: 1 }));
    assert.equal(plan.tier, 2);
  });

  it("escalates when the project count passes the threshold", () => {
    const plan = classifyChangePlan(
      [
        op({ action: "read", entityType: "task", entityId: 1, projectId: 1 }),
        op({ action: "read", entityType: "task", entityId: 2, projectId: 2 }),
      ],
      withSettings({ maxProjects: 1 }),
    );
    assert.equal(plan.tier, 3);
    assert.match(plan.escalations.join(" "), /Project count 2 exceeds the limit of 1/);
  });

  it("keeps the operation tier while both counts stay within the limits", () => {
    const operations = Array.from({ length: 5 }, (_, index) =>
      op({
        action: "propose_update",
        entityType: "task",
        entityId: index + 1,
        projectId: index < 3 ? 1 : 2,
      }),
    );
    const plan = classifyChangePlan(operations);
    assert.equal(plan.tier, 2);
    assert.deepEqual(plan.escalations, []);
  });

  it("stamps a proposal's own tier and ignores a declared tier", () => {
    const operation = operationFromProposal(
      {
        action: "create",
        entityType: "task",
        projectId: 4,
        fields: { title: "Ship it", tier: 0 },
        tier: 0,
      },
      1,
    );
    const plan = classifyChangePlan([operation]);
    assert.equal(plan.tier, 2);
    assert.equal(plan.operations[0]?.tier, 2);
    assert.equal(Object.prototype.hasOwnProperty.call(operation.fields, "tier"), false);
  });

  it("classifies a link proposal as tier 1", () => {
    const operation = operationFromProposal(
      {
        action: "create",
        policyAction: "link",
        entityType: "task",
        entityId: 3,
        fields: { dependsOnTaskId: 9, tier: 0 },
        tier: 0,
      },
      1,
    );
    const plan = classifyChangePlan([operation], withSettings({ tier1OptIn: true }));
    assert.equal(operation.action, "link");
    assert.equal(plan.operations[0]?.tier, 1);
  });
});

describe("permission settings", () => {
  it("falls back to defaults when the stored document is invalid", () => {
    const parsed = parseStoredAiPermissionTiers({ matrix: "nope" });
    assert.equal(parsed.tier1Enabled, true);
    assert.equal(parsed.maxRecords, 5);
    assert.equal(parsed.maxProjects, 2);
    assert.equal(parsed.matrix.comment, 1);
  });

  it("merges a partial matrix onto the defaults", () => {
    const parsed = parseStoredAiPermissionTiers({
      matrix: { comment: 3 },
      tier1Enabled: false,
      maxRecords: 8,
      maxProjects: 2,
    });
    assert.equal(parsed.matrix.comment, 3);
    assert.equal(parsed.matrix.read, 0);
    assert.equal(parsed.tier1Enabled, false);
    assert.equal(parsed.maxRecords, 8);
  });
});

describe("delete proposals", () => {
  it("recognizes a delete the model must not execute", () => {
    assert.equal(isAiDeleteProposal({ action: "delete", method: "DELETE" }), true);
    assert.equal(isAiDeleteProposal({ action: "propose_delete", method: "POST" }), true);
    assert.equal(isAiDeleteProposal({ action: "create", method: "POST" }), false);
    assert.equal(isAiDeleteProposal(null), false);
    assert.equal(AI_DELETE_DENY_REASON, "AI cannot execute deletes");
  });
});

describe("check tiers", () => {
  it("keeps a floor deny at tier 3", () => {
    const decision = check({
      actorUserId: 1,
      feature: "assistant",
      action: "read",
      resource: "api_key",
      tier: 0,
    });
    assert.equal(decision.decision, "deny");
    assert.equal(decision.tier, 3);
  });

  it("denies ownership transfer and escalates reassignment", () => {
    const ownership = check({
      actorUserId: 1,
      feature: "assistant",
      action: "apply",
      entityType: "task",
      fields: { ownerId: 2 },
    });
    assert.equal(ownership.decision, "deny");
    assert.equal(ownership.tier, 3);

    const reassignment = check({
      actorUserId: 1,
      feature: "assistant",
      action: "propose_update",
      entityType: "task",
      fields: { assigneeId: 9 },
    });
    assert.equal(reassignment.decision, "allow");
    assert.equal(reassignment.tier, 3);
  });

  it("does not let a supplied tier lower an apply", () => {
    const decision = check({
      actorUserId: 1,
      feature: "assistant",
      action: "apply",
      entityType: "idea",
      tier: 0,
    });
    assert.equal(decision.decision, "allow");
    assert.equal(decision.tier, 2);
  });
});
