import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertProviderContract, registerProviderHostPolicy } from "@taskmesh/ai-provider-contract";
import { isBlockedHostname } from "../../../../src/lib/privateNet.ts";
import { configSchema, plugin } from "./index.ts";

registerProviderHostPolicy((host) => isBlockedHostname(host));

describe("OpenAI-compatible provider contract", () => {
  it("passes the shared contract kit", async () => {
    await assertProviderContract(plugin, {
      baseUrl: "https://example.com/v1",
      defaultModel: "compat-test",
    });
  });

  it("requires a public https base URL and a model", () => {
    assert.equal(configSchema.safeParse({}).success, false);
    assert.equal(
      configSchema.safeParse({ baseUrl: "http://127.0.0.1:1234/v1", defaultModel: "local" }).success,
      false,
    );
    assert.equal(
      configSchema.safeParse({ baseUrl: "https://example.com/v1", defaultModel: "mistral" }).success,
      true,
    );
  });
});
