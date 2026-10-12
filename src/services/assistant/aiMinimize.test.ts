import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { z } from "zod";
import type { AiChatMessage, AiProviderPlugin, AiToolDefinition } from "@taskmesh/ai-provider-contract";
import { pool } from "../../db/client.js";
import type { AiAuditInput } from "./aiAudit.js";
import {
  ENTITY_EXCERPT_MAX,
  excerptText,
  minimizeDocument,
  minimizeIdea,
  minimizeProject,
  minimizeTask,
  redactSecrets,
} from "./aiMinimize.js";
import { capUrlQuery, MAX_URL_QUERY_LENGTH } from "./fetchUrl.js";
import { runAssistantWithTools } from "./runWithTools.js";
import { assistantToolDefinitions, executeAssistantTool } from "./tools.js";
import { unwrapUntrusted } from "./untrustedContent.js";

const SECRET = "sk-test-secret-key-0123456789abcdef";

after(async () => {
  await pool.end();
});

describe("redactSecrets", () => {
  it("replaces provider keys, tokens, private keys, connection strings, and assignments", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----";
    const samples = [
      SECRET,
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
      "AIzaSyA1234567890abcdefghij",
      "Authorization: Bearer abc.def-ghi",
      "postgres://user:secret@db.internal:5432/taskmesh",
      "mysql://root:secret@localhost/app",
      "mongodb+srv://user:secret@cluster.example/db",
      "password=hunter2",
      "api_key=abcd",
      "token=zzzz",
      pem,
    ];
    for (const sample of samples) {
      const out = redactSecrets(`before ${sample} after`);
      assert.equal(out.includes(sample), false, sample.slice(0, 24));
      assert.match(out, /\[redacted\]/);
    }
  });

  it("leaves ordinary prose unchanged", () => {
    const text = "The task is due Friday and the priority is high.";
    assert.equal(redactSecrets(text), text);
  });
});

describe("entity allowlist", () => {
  it("keeps task fields the model may see and clips the description", () => {
    const row = {
      id: 12,
      projectId: 4,
      title: "Ship guardrails",
      description: "x".repeat(ENTITY_EXCERPT_MAX + 500),
      dueDate: "2026-10-12",
      number: 179,
      state: "ready",
      priority: "high",
      parentId: 9,
      color: "#fff",
      phaseId: 3,
      ownerId: 1,
      email: "person@example.com",
      tags: ["ai"],
    };
    const out = minimizeTask(row);
    assert.deepEqual(Object.keys(out).sort(), [
      "description",
      "dueDate",
      "id",
      "number",
      "priority",
      "projectId",
      "state",
      "tags",
      "title",
      "type",
    ]);
    assert.equal(out.description.length, ENTITY_EXCERPT_MAX + 1);
    assert.equal(out.description.endsWith("…"), true);
    assert.equal("color" in out, false);
    assert.equal("phaseId" in out, false);
    assert.equal("parentId" in out, false);
    assert.equal("ownerId" in out, false);
    assert.equal("email" in out, false);
    assert.deepEqual(out.tags, ["ai"]);
  });

  it("redacts a fake API key inside an allowed excerpt", () => {
    const out = minimizeTask({
      id: 1,
      projectId: null,
      title: "Notes",
      description: `prefix ${SECRET} suffix`,
      state: "new",
      tags: [],
    });
    assert.equal(out.description.includes(SECRET), false);
    assert.match(out.description, /\[redacted\]/);
  });

  it("allowlists idea, project, and document the same way", () => {
    const ideaRow = {
      id: 1,
      title: "Idea",
      body: "body",
      ownerId: 1,
      tags: ["n"],
    };
    const projectRow = {
      id: 2,
      name: "Proj",
      description: "d",
      status: "active",
      ownerId: 1,
      tags: [] as string[],
    };
    const documentRow = {
      id: 3,
      projectId: 2,
      title: "Doc",
      body: "b",
      createdById: 1,
      tags: ["d"],
    };
    const idea = minimizeIdea(ideaRow);
    const project = minimizeProject(projectRow);
    const document = minimizeDocument(documentRow);
    assert.deepEqual(Object.keys(idea).sort(), ["body", "id", "tags", "title", "type"]);
    assert.deepEqual(Object.keys(project).sort(), [
      "description",
      "id",
      "name",
      "status",
      "tags",
      "type",
    ]);
    assert.deepEqual(Object.keys(document).sort(), [
      "body",
      "id",
      "projectId",
      "tags",
      "title",
      "type",
    ]);
    assert.equal(excerptText("ok"), "ok");
  });
});

describe("capUrlQuery", () => {
  it("truncates a long query string and leaves a short one", () => {
    const long = "b".repeat(MAX_URL_QUERY_LENGTH + 40);
    const capped = new URL(capUrlQuery(`https://example.com/a?${long}`));
    assert.equal(capped.search.slice(1).length, MAX_URL_QUERY_LENGTH);
    assert.equal(capped.search.slice(1), "b".repeat(MAX_URL_QUERY_LENGTH));
    assert.equal(capped.hostname, "example.com");

    const short = capUrlQuery("https://example.com/a?q=mesh");
    assert.equal(new URL(short).search, "?q=mesh");
    assert.equal(capUrlQuery("not a url"), "not a url");
  });
});

describe("assistant tool list", () => {
  it("hides fetch_url until web fetch is enabled", () => {
    const names = (tools: AiToolDefinition[]) => tools.map((tool) => tool.name);
    assert.equal(names(assistantToolDefinitions()).includes("fetch_url"), false);
    assert.equal(
      names(assistantToolDefinitions({ webFetchEnabled: true })).includes("fetch_url"),
      true,
    );
  });
});

describe("web fetch audit", () => {
  it("logs the capped URL when a private fetch is refused", async () => {
    const rows: AiAuditInput[] = [];
    const query = "c".repeat(MAX_URL_QUERY_LENGTH + 20);
    const raw = await executeAssistantTool(
      "fetch_url",
      JSON.stringify({ url: `http://127.0.0.1/secret?${query}` }),
      {
        actorUserId: 1,
        webFetchEnabled: true,
        checkPolicy: () => ({ decision: "allow", tier: 0, reason: "test allow" }),
        recordAudit: async (row) => {
          rows.push(row);
        },
      },
    );
    const body = JSON.parse(unwrapUntrusted(raw)) as { error?: string };
    assert.equal(typeof body.error, "string");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.action, "web_fetch");
    assert.match(rows[0]?.reason ?? "", /^Fetched http:\/\/127\.0\.0\.1\/secret\?/);
    const logged = rows[0]?.reason?.slice("Fetched ".length) ?? "";
    assert.equal(new URL(logged).search.slice(1).length, MAX_URL_QUERY_LENGTH);
  });
});

describe("stub plugin boundary", () => {
  it("never sends a record's fake API key to the provider", async () => {
    const seen: string[] = [];
    let round = 0;
    const plugin: AiProviderPlugin = {
      id: "stub",
      displayName: "Stub",
      version: "0",
      configSchema: z.object({}),
      capabilities: {
        chat: true,
        streaming: true,
        tools: true,
        embeddings: false,
        local: true,
      },
      async listModels() {
        return [];
      },
      async verifyKey() {
        return { ok: true };
      },
      async *streamChat(_ctx, args) {
        seen.push(JSON.stringify(args.messages));
        const tools = (args.tools ?? []).map((tool) => tool.name);
        seen.push(tools.join(","));
        round += 1;
        if (round === 1) {
          yield {
            type: "tool_calls",
            calls: [{ id: "call_1", name: "get_entity", arguments: "{}" }],
          };
        } else {
          yield { type: "delta", text: "Done." };
        }
        yield { type: "done" };
      },
    };

    const record = JSON.stringify({
      type: "task",
      title: "Leak",
      description: `notes ${SECRET}`,
      color: "#fff",
    });

    await runAssistantWithTools({
      plugin,
      apiKey: "test",
      config: {},
      messages: [{ role: "user", content: `Please read ${SECRET}` }],
      actorUserId: 1,
      isAdministrator: false,
      webFetchEnabled: false,
      assertBaseUrl: async (url) => url,
      executeTool: async () => record,
      handlers: {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: (message) => {
          throw new Error(message);
        },
      },
    });

    assert.equal(round, 2);
    const payload = seen.join("\n");
    assert.equal(payload.includes(SECRET), false);
    assert.match(payload, /\[redacted\]/);
    assert.equal(seen.some((line) => line.includes("fetch_url")), false);
    const toolMessage = JSON.parse(seen[2] ?? "[]") as AiChatMessage[];
    assert.equal(toolMessage.some((message) => message.role === "tool"), true);
  });
});
