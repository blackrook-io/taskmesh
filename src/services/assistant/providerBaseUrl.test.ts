import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderConfigError } from "@taskmesh/ai-provider-contract";
import { assertPublicProviderBaseUrl } from "./providerBaseUrl.js";

describe("provider base URL", () => {
  it("rejects http, credentials, and private hosts before DNS", async () => {
    for (const raw of [
      "http://api.openai.com/v1",
      "https://127.0.0.1/v1",
      "https://169.254.169.254/",
      "https://user:pass@api.openai.com/v1",
      "not a url",
    ]) {
      await assert.rejects(() => assertPublicProviderBaseUrl(raw), ProviderConfigError);
    }
  });
});
