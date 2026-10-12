import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertProviderContract, registerProviderHostPolicy } from "@taskmesh/ai-provider-contract";
import { isBlockedHostname } from "../../../../src/lib/privateNet.ts";
import { runGoldenCases } from "../../../../src/services/assistant/golden/run.ts";
import { plugin } from "./index.ts";

registerProviderHostPolicy((host) => isBlockedHostname(host));

describe("stub provider contract", () => {
  it("passes the shared contract kit, including embeddings", async () => {
    await assertProviderContract(plugin, {
      baseUrl: "https://stub.example.com",
      defaultModel: "stub",
    });
  });

  it("matches the assistant golden set", async () => {
    const results = await runGoldenCases({
      plugin,
      apiKey: "test",
      config: { baseUrl: "https://stub.example.com", defaultModel: "stub" },
      assertBaseUrl: async (url) => url,
      mode: "stub",
    });
    assert.equal(results.length > 0, true);
    for (const result of results) {
      assert.equal(result.ok, true, result.detail);
    }
  });
});
