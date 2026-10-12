import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadAiProviderPlugins } from "./providerLoader.js";

const scratch: string[] = [];

async function writePlugin(root: string, name: string, role: string, id = name): Promise<void> {
  const dir = path.join(root, name);
  await fs.mkdir(path.join(dir, "dist"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: `@taskmesh/ai-provider-${name}`,
      type: "module",
      taskmesh: { role },
    }),
  );
  await fs.writeFile(
    path.join(dir, "dist", "index.js"),
    `export const plugin = { id: ${JSON.stringify(id)}, displayName: "Fixture", version: "0", configSchema: { parse(v) { return v; } }, capabilities: { chat: true, streaming: false, tools: false, embeddings: false, local: false }, async listModels() { return []; }, async verifyKey() { return { ok: true }; }, async *streamChat() {} };\n`,
  );
}

describe("AI provider loader", () => {
  after(async () => {
    await Promise.all(scratch.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("loads provider packages and skips other roles and escaped paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tm-ai-providers-"));
    scratch.push(root);
    await writePlugin(root, "fixture", "provider");
    await writePlugin(root, "stub", "test");
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "tm-ai-outside-"));
    scratch.push(outside);
    await writePlugin(outside, "evil", "provider");
    await fs.symlink(path.join(outside, "evil"), path.join(root, "evil"));

    const plugins = await loadAiProviderPlugins(root);
    assert.deepEqual(plugins.map((plugin) => plugin.id), ["fixture"]);
  });
});
