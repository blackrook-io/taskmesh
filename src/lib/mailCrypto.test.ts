import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { decryptMailSecret, encryptMailSecret, hasMailCredentialsKey } from "./mailCrypto.js";

const TEST_KEY = "mail-crypto-unit-test-key-32chars!";

describe("mailCrypto", () => {
  const prev = process.env.EMAIL_CREDENTIALS_KEY;

  afterEach(() => {
    if (prev === undefined) delete process.env.EMAIL_CREDENTIALS_KEY;
    else process.env.EMAIL_CREDENTIALS_KEY = prev;
  });

  it("round-trips a secret and does not store the plaintext", () => {
    process.env.EMAIL_CREDENTIALS_KEY = TEST_KEY;
    const secret = "smtp-password-value";
    const payload = encryptMailSecret(secret);
    assert.equal(payload.includes(secret), false);
    assert.equal(decryptMailSecret(payload), secret);
  });

  it("reports when the key is unset", () => {
    delete process.env.EMAIL_CREDENTIALS_KEY;
    assert.equal(hasMailCredentialsKey(), false);
    assert.throws(() => encryptMailSecret("x"), /EMAIL_CREDENTIALS_KEY/);
  });
});
