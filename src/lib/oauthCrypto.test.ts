import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decryptOauthSecret,
  encryptOauthSecret,
  hasOauthCredentialsKey,
  OauthCredentialsKeyError,
} from "./oauthCrypto.js";

describe("oauthCrypto", () => {
  it("round-trips secrets when OAUTH_CREDENTIALS_KEY is set", () => {
    const prev = process.env.OAUTH_CREDENTIALS_KEY;
    process.env.OAUTH_CREDENTIALS_KEY = "test-oauth-credentials-key-for-unit";
    try {
      assert.equal(hasOauthCredentialsKey(), true);
      const enc = encryptOauthSecret("super-secret-value");
      assert.notEqual(enc, "super-secret-value");
      assert.equal(decryptOauthSecret(enc), "super-secret-value");
    } finally {
      if (prev === undefined) delete process.env.OAUTH_CREDENTIALS_KEY;
      else process.env.OAUTH_CREDENTIALS_KEY = prev;
    }
  });

  it("throws when key is missing", () => {
    const prev = process.env.OAUTH_CREDENTIALS_KEY;
    delete process.env.OAUTH_CREDENTIALS_KEY;
    try {
      assert.equal(hasOauthCredentialsKey(), false);
      assert.throws(() => encryptOauthSecret("x"), OauthCredentialsKeyError);
    } finally {
      if (prev !== undefined) process.env.OAUTH_CREDENTIALS_KEY = prev;
    }
  });
});
