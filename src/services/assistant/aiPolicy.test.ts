import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { pool } from "../../db/client.js";
import {
  check,
  describeAllowedPolicy,
  projectPolicyLayer,
  userPolicyLayer,
  type PolicyCheckInput,
  type PolicyDecision,
} from "./aiPolicy.js";
import { executeAssistantTool } from "./tools.js";
import type { AiAuditInput } from "./aiAudit.js";

const FLOOR = [
  "user",
  "role",
  "group",
  "api_key",
  "ai_credential",
  "backup",
  "ownership",
  "system_property",
  "ai_policy",
] as const;

function allowAll(): PolicyDecision {
  return { decision: "allow", tier: 0, reason: "test allow" };
}

function base(over: Partial<PolicyCheckInput> = {}): PolicyCheckInput {
  return {
    actorUserId: 1,
    feature: "assistant",
    action: "read",
    ...over,
  };
}

after(async () => {
  await pool.end();
});

describe("aiPolicy.check", () => {
  it("denies every floor resource even when every layer would allow", () => {
    const layers = { instance: allowAll, project: allowAll, user: allowAll };
    for (const resource of FLOOR) {
      const decision = check(base({ resource, action: "read" }), layers);
      assert.equal(decision.decision, "deny", resource);
      assert.equal(decision.tier, 3, resource);
      assert.match(decision.reason, new RegExp(resource));
    }
  });

  it("denies ownerId transfer even when every layer would allow", () => {
    const decision = check(
      base({
        action: "apply",
        entityType: "task",
        fields: { title: "Keep", ownerId: 2 },
      }),
      { instance: allowAll, project: allowAll, user: allowAll },
    );
    assert.equal(decision.decision, "deny");
    assert.equal(decision.tier, 3);
    assert.match(decision.reason, /ownership/i);
  });

  it("does not consult layers after a floor deny", () => {
    const boom = (): PolicyDecision => {
      throw new Error("layer should not run");
    };
    const decision = check(base({ resource: "api_key" }), {
      instance: boom,
      project: boom,
      user: boom,
    });
    assert.equal(decision.decision, "deny");
  });

  it("intersects layers so an instance deny wins over allow-all project and user", () => {
    assert.equal(projectPolicyLayer(base({ action: "link", entityType: "task" })).decision, "allow");
    assert.equal(userPolicyLayer(base({ action: "link", entityType: "task" })).decision, "allow");
    const decision = check(base({ action: "link", entityType: "task" }));
    assert.equal(decision.decision, "deny");
    assert.equal(decision.tier, 2);
    assert.match(decision.reason, /instance/i);
  });

  it("allows the assistant actions that exist today", () => {
    assert.equal(check(base({ action: "read" })).decision, "allow");
    assert.equal(check(base({ action: "read", entityType: "document" })).decision, "allow");
    assert.equal(check(base({ action: "web_fetch" })).decision, "deny");
    assert.equal(
      check(base({ action: "web_fetch", webFetchEnabled: true })).decision,
      "allow",
    );
    assert.equal(
      check(base({ action: "web_fetch", webFetchEnabled: true, feature: "mesh" })).decision,
      "deny",
    );
    assert.equal(
      check(base({ action: "propose_create", entityType: "task", projectId: 4 })).decision,
      "allow",
    );
    assert.equal(check(base({ action: "apply", entityType: "idea" })).tier, 2);
  });

  it("denies unimplemented actions and other entity types", () => {
    assert.equal(check(base({ action: "propose_delete", entityType: "task" })).decision, "deny");
    assert.equal(check(base({ action: "bulk", entityType: "task" })).tier, 3);
    assert.equal(check(base({ action: "read", entityType: "todo" })).decision, "deny");
    assert.equal(check(base({ action: "apply" })).decision, "deny");
  });
});

describe("describeAllowedPolicy", () => {
  it("names the floor and says the server enforces the rules", () => {
    const text = describeAllowedPolicy("assistant");
    assert.match(text, /server enforces/i);
    assert.match(text, /model cannot set it/i);
    assert.match(text, /Deletes are proposals only/);
    assert.match(text, /API keys/);
    assert.match(text, /users/);
    assert.doesNotMatch(text, /fetch public web pages/);
  });

  it("mentions web fetch only when the administrator switch is on", () => {
    const text = describeAllowedPolicy("assistant", { webFetchEnabled: true });
    assert.match(text, /fetch public web pages/);
  });
});

describe("assistant tool policy gate", () => {
  it("returns a structured denial and one audit row without throwing", async () => {
    const rows: AiAuditInput[] = [];
    const raw = await executeAssistantTool("search_records", JSON.stringify({ q: "mesh" }), {
      actorUserId: 1,
      checkPolicy: () => ({ decision: "deny", tier: 0, reason: "test deny" }),
      recordAudit: async (row) => {
        rows.push(row);
      },
    });
    const body = JSON.parse(raw) as {
      denied?: boolean;
      decision?: string;
      action?: string;
      reason?: string;
      tier?: number;
    };
    assert.equal(body.denied, true);
    assert.equal(body.decision, "deny");
    assert.equal(body.action, "read");
    assert.equal(body.reason, "test deny");
    assert.equal(body.tier, 0);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.decision, "deny");
    assert.equal(rows[0]?.action, "read");
    assert.equal(rows[0]?.tool, "search_records");
  });

  it("reaches the tool body when policy allows", async () => {
    const rows: AiAuditInput[] = [];
    const raw = await executeAssistantTool("search_records", JSON.stringify({ q: "" }), {
      actorUserId: 1,
      isAdministrator: true,
      checkPolicy: () => ({ decision: "allow", tier: 0, reason: "test allow" }),
      recordAudit: async (row) => {
        rows.push(row);
      },
    });
    const body = JSON.parse(raw) as { denied?: boolean; error?: string };
    assert.notEqual(body.denied, true);
    assert.equal(typeof body.error, "string");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.decision, "allow");
  });
});
