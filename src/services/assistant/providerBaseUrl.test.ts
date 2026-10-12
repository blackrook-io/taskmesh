import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderConfigError } from "@taskmesh/ai-provider-contract";
import { assertLocalProviderBaseUrl, assertPublicProviderBaseUrl } from "./providerBaseUrl.js";

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

  it("allows private http hosts for a local provider and still rejects metadata", async () => {
    assert.equal(await assertLocalProviderBaseUrl("http://127.0.0.1:11434"), "http://127.0.0.1:11434");
    assert.equal(await assertLocalProviderBaseUrl("http://10.1.2.3:11434/"), "http://10.1.2.3:11434");
    assert.equal(await assertLocalProviderBaseUrl("http://localhost:11434"), "http://localhost:11434");
    for (const raw of ["http://169.254.169.254/", "http://metadata.google.internal/", "file:///tmp/x"]) {
      await assert.rejects(() => assertLocalProviderBaseUrl(raw), ProviderConfigError);
    }
    await assert.rejects(() => assertPublicProviderBaseUrl("http://127.0.0.1:11434"), ProviderConfigError);
  });
});
