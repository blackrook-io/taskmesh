import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { decryptAiSecret, encryptAiSecret } from "./aiCredentialsCrypto.js";

const TEST_KEY = "test-ai-credentials-key-32chars!!";

describe("aiCredentialsCrypto", () => {
  const prev = process.env.AI_CREDENTIALS_KEY;

  afterEach(() => {
    if (prev === undefined) delete process.env.AI_CREDENTIALS_KEY;
    else process.env.AI_CREDENTIALS_KEY = prev;
  });

  it("round-trips a secret and does not store the plaintext", () => {
    process.env.AI_CREDENTIALS_KEY = TEST_KEY;
    const secret = "sk-test-instance-key-value";
    const payload = encryptAiSecret(secret);
    assert.equal(payload.includes(secret), false);
    assert.equal(decryptAiSecret(payload), secret);
  });

  it("refuses to encrypt when the key is unset", () => {
    delete process.env.AI_CREDENTIALS_KEY;
    assert.throws(() => encryptAiSecret("sk-test"), /AI_CREDENTIALS_KEY/);
  });
});
