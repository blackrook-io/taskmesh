import { describe, it } from "node:test";
import { assertProviderContract, registerProviderHostPolicy } from "@taskmesh/ai-provider-contract";
import { isBlockedHostname } from "../../../../src/lib/privateNet.ts";
import { plugin } from "./index.ts";

registerProviderHostPolicy((host) => isBlockedHostname(host));

describe("stub provider contract", () => {
  it("passes the shared contract kit, including embeddings", async () => {
    await assertProviderContract(plugin, {
      baseUrl: "https://stub.example.com",
      defaultModel: "stub",
    });
  });
});
