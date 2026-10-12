import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AiProviderPlugin } from "@taskmesh/ai-provider-contract";
import type { AiAuditInput } from "./aiAudit.js";
import { buildMessages } from "./index.js";
import {
  PromptRegistryError,
  composeAssistantPrompt,
  loadPrompt,
} from "./promptRegistry.js";
import { runAssistantWithTools } from "./runWithTools.js";

const ASSISTANT_V1 = `You are the TaskMesh assistant embedded in a personal project / ideas / tasks app.
Help the user research, summarize, draft Markdown, and plan work.

You have tools to search and read TaskMesh records and propose creating or updating ideas, documents, tasks, todos, and todo lists.
You can also propose a link, a tag, a comment, or a task dependency. You cannot delete, unlink, untag, or remove a dependency.
Proposed changes are NOT saved until the user confirms in the UI. Never claim you saved or applied a change.
When the user asks to add or create a task, idea, document, todo, or list, use the matching propose_*_create tool (not an update tool).
When editing an existing record, use the propose_*_update tools after get_entity or search when needed.
Use get_neighbourhood for nearby records. There is no path-finding tool.
Prefer get_entity / search_records / list_project_context / list_todos so you work from current content.
If page context is attached, treat it as the user's current draft/record and prefer it over guessing.
Be concise. Prefer clear Markdown structure.`;

const FETCH_V1 = `You can fetch public web pages with fetch_url.
When researching with fetch_url, cite the source URL in your reply (title + link). Do not invent URLs you did not fetch.`;

function plugin(): AiProviderPlugin {
  return {
    id: "openai",
    displayName: "OpenAI",
    version: "0.0.0",
    configSchema: { safeParse: () => ({ success: true as const, data: {} }) } as unknown as AiProviderPlugin["configSchema"],
    capabilities: { chat: true, streaming: true, tools: true, embeddings: false, local: false },
    listModels: async () => [],
    verifyKey: async () => ({ ok: true }),
    async *streamChat() {
      yield { type: "delta", text: "ok" };
      yield { type: "done" };
    },
  };
}

describe("prompt registry", () => {
  it("loads the shipped assistant wording and composes the web-fetch addendum", () => {
    const base = loadPrompt({ id: "assistant" });
    assert.equal(base.version, 1);
    assert.equal(base.providerId, null);
    assert.equal(base.ref, "assistant@1");
    assert.equal(base.body, ASSISTANT_V1);

    const plain = composeAssistantPrompt({ webFetchEnabled: false });
    assert.equal(plain.text, ASSISTANT_V1);
    assert.equal(plain.promptRef, "assistant@1");

    const withFetch = composeAssistantPrompt({ webFetchEnabled: true });
    assert.equal(withFetch.text, `${ASSISTANT_V1}\n${FETCH_V1}`);
    assert.equal(withFetch.promptId, "assistant");
    assert.equal(withFetch.promptVersion, 1);
    assert.equal(withFetch.promptRef, "assistant@1+assistant_web_fetch@1");

    const messages = buildMessages({
      history: [],
      userMessage: "hello",
      webFetchEnabled: false,
    });
    assert.equal(messages[0]?.role, "system");
    assert.equal(messages[0]?.content.startsWith(`${ASSISTANT_V1}\n\n`), true);
    assert.equal(messages[0]?.content.includes("fetch_url"), false);
    const fetching = buildMessages({
      history: [],
      userMessage: "hello",
      webFetchEnabled: true,
    });
    assert.equal(fetching[0]?.content.includes(FETCH_V1), true);
  });

  it("prefers a provider file and records that variant in the ref", () => {
    const root = mkdtempSync(join(tmpdir(), "tm-prompts-"));
    try {
      mkdirSync(join(root, "assistant", "ollama"), { recursive: true });
      mkdirSync(join(root, "assistant_web_fetch"), { recursive: true });
      writeFileSync(join(root, "assistant", "v1.md"), "default one\n");
      writeFileSync(join(root, "assistant", "v2.md"), "default two\n");
      writeFileSync(join(root, "assistant", "ollama", "v1.md"), "ollama wording\n");
      writeFileSync(join(root, "assistant_web_fetch", "v1.md"), "fetch wording\n");

      const variant = loadPrompt({ id: "assistant", providerId: "ollama", root });
      assert.equal(variant.body, "ollama wording");
      assert.equal(variant.version, 1);
      assert.equal(variant.ref, "assistant@1/ollama");

      const fallback = loadPrompt({ id: "assistant", providerId: "openai", root });
      assert.equal(fallback.body, "default two");
      assert.equal(fallback.ref, "assistant@2");

      const composed = composeAssistantPrompt({ webFetchEnabled: true, providerId: "ollama", root });
      assert.equal(composed.promptRef, "assistant@1/ollama+assistant_web_fetch@1");
      assert.equal(composed.text, "ollama wording\nfetch wording");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a missing id and a path-like id", () => {
    const root = mkdtempSync(join(tmpdir(), "tm-prompts-"));
    try {
      mkdirSync(join(root, "assistant"), { recursive: true });
      writeFileSync(join(root, "assistant", "v1.md"), "ok\n");
      assert.throws(() => loadPrompt({ id: "missing", root }), PromptRegistryError);
      assert.throws(() => loadPrompt({ id: "../assistant", root }), PromptRegistryError);
      assert.throws(() => loadPrompt({ id: "assistant", providerId: "../x", root }), PromptRegistryError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("records the prompt ref on the respond row and leaves the route row empty", async () => {
    const composed = composeAssistantPrompt({ webFetchEnabled: false });
    const rows: AiAuditInput[] = [];
    await runAssistantWithTools({
      plugin: plugin(),
      apiKey: "test",
      config: {},
      messages: [{ role: "user", content: "hello" }],
      actorUserId: 1,
      isAdministrator: false,
      assertBaseUrl: async (url) => url,
      routeReason: "automatic",
      prompt: {
        promptId: composed.promptId,
        promptVersion: composed.promptVersion,
        promptRef: composed.promptRef,
      },
      auditSink: async (row) => {
        rows.push(row);
        return 7;
      },
      handlers: {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: (message) => {
          throw new Error(message);
        },
      },
    });
    const respond = rows.find((row) => row.action === "respond");
    const route = rows.find((row) => row.action === "route");
    assert.equal(respond?.promptId, "assistant");
    assert.equal(respond?.promptVersion, 1);
    assert.equal(respond?.promptRef, "assistant@1");
    assert.equal(route?.promptId ?? null, null);
    assert.equal(route?.promptVersion ?? null, null);
    assert.equal(route?.promptRef ?? null, null);
    assert.equal(JSON.stringify(rows).includes(ASSISTANT_V1), false);
  });
});
