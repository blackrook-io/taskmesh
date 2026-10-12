import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { pool } from "../../db/client.js";
import {
  AI_ACTIONS,
  check,
  describeAllowedPolicy,
  projectPolicyLayer,
  userPolicyLayer,
  type PolicyCheckInput,
  type PolicyDecision,
} from "./aiPolicy.js";
import { executeAssistantTool, OPENAI_TOOLS } from "./tools.js";
import { TOOL_REGISTRY } from "./toolRegistry.js";
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
    assert.equal(projectPolicyLayer(base({ action: "bulk", entityType: "task" })).decision, "allow");
    assert.equal(userPolicyLayer(base({ action: "bulk", entityType: "task" })).decision, "allow");
    const decision = check(base({ action: "bulk", entityType: "task" }));
    assert.equal(decision.decision, "deny");
    assert.equal(decision.tier, 3);
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
      check(base({ action: "propose_create", entityType: "task", projectId: 4, projectAiAccess: "full" }))
        .decision,
      "allow",
    );
    assert.equal(check(base({ action: "apply", entityType: "idea" })).tier, 2);
  });

  it("fails closed when a project id has no resolved access", () => {
    const decision = check(base({ action: "read", entityType: "task", projectId: 4 }));
    assert.equal(decision.decision, "deny");
    assert.match(decision.reason, /not resolved/i);
  });

  it("narrows by project AI access", () => {
    assert.equal(
      check(base({ action: "read", entityType: "task", projectId: 4, projectAiAccess: "read_only" }))
        .decision,
      "allow",
    );
    const write = check(
      base({
        action: "propose_update",
        entityType: "task",
        projectId: 4,
        projectAiAccess: "read_only",
      }),
    );
    assert.equal(write.decision, "deny");
    assert.match(write.reason, /read-only/i);
    const excluded = check(
      base({ action: "read", entityType: "document", projectId: 4, projectAiAccess: "excluded" }),
    );
    assert.equal(excluded.decision, "deny");
    assert.match(excluded.reason, /excluded/i);
  });

  it("denies a move into a narrower project", () => {
    const decision = check(
      base({
        action: "propose_update",
        entityType: "task",
        projectId: 1,
        projectAiAccess: "full",
        destinationAiAccess: "excluded",
        fields: { projectId: 2 },
      }),
    );
    assert.equal(decision.decision, "deny");
    assert.match(decision.reason, /excluded/i);
  });

  it("denies a proposal that changes project AI access", () => {
    const decision = check(
      base({
        action: "apply",
        entityType: "task",
        projectId: 4,
        projectAiAccess: "full",
        fields: { title: "Keep", aiAccess: "excluded" },
      }),
      { instance: allowAll, project: allowAll, user: allowAll },
    );
    assert.equal(decision.decision, "deny");
    assert.match(decision.reason, /project AI access/i);
  });

  it("denies unimplemented actions and record types outside the assistant set", () => {
    assert.equal(check(base({ action: "propose_delete", entityType: "task" })).decision, "deny");
    assert.equal(check(base({ action: "bulk", entityType: "task" })).tier, 3);
    assert.equal(check(base({ action: "read", entityType: "todo" })).decision, "allow");
    assert.equal(check(base({ action: "read", entityType: "canvas" })).decision, "deny");
    assert.equal(check(base({ action: "link", entityType: "task" })).decision, "allow");
    assert.equal(check(base({ action: "tag", entityType: "project" })).decision, "allow");
    assert.equal(check(base({ action: "comment", entityType: "todo_list" })).decision, "allow");
    assert.equal(check(base({ action: "link", entityType: "canvas" })).decision, "deny");
    assert.equal(check(base({ action: "link" })).decision, "deny");
    assert.equal(check(base({ action: "propose_create", entityType: "todo" })).decision, "allow");
    assert.equal(check(base({ action: "propose_create", entityType: "project" })).decision, "deny");
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
    assert.match(text, /Excluded projects/);
    assert.match(text, /Read-only projects/);
    assert.match(text, /users/);
    assert.doesNotMatch(text, /fetch public web pages/);
  });

  it("mentions web fetch only when the administrator switch is on", () => {
    const text = describeAllowedPolicy("assistant", { webFetchEnabled: true });
    assert.match(text, /fetch public web pages/);
  });
});

describe("assistant tool registry", () => {
  it("maps every declared tool to a policy action", () => {
    const declared = OPENAI_TOOLS.map((tool) => tool.function.name);
    const registered = Object.keys(TOOL_REGISTRY);
    assert.deepEqual([...registered].sort(), [...declared].sort());
    for (const name of declared) {
      const row = TOOL_REGISTRY[name];
      assert.ok(row, name);
      assert.ok((AI_ACTIONS as readonly string[]).includes(row.action), name);
    }
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
