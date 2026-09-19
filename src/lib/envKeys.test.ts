import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ENV_KEY_MIN_LENGTH,
  assertConfiguredEnvKeys,
  assertEnvKeyStrength,
  readStrongEnvKey,
} from "./envKeys.js";

describe("envKeys", () => {
  it("allows unset keys", () => {
    assert.doesNotThrow(() =>
      assertEnvKeyStrength("MFA_TOTP_KEY", { MFA_TOTP_KEY: undefined }),
    );
    assert.equal(readStrongEnvKey("MFA_TOTP_KEY", {}), null);
  });

  it("rejects short keys", () => {
    assert.throws(
      () => assertEnvKeyStrength("MFA_TOTP_KEY", { MFA_TOTP_KEY: "too-short" }),
      /at least 32/,
    );
  });

  it("accepts keys at the minimum length", () => {
    const ok = "x".repeat(ENV_KEY_MIN_LENGTH);
    assert.doesNotThrow(() =>
      assertConfiguredEnvKeys({
        MFA_TOTP_KEY: ok,
        OAUTH_CREDENTIALS_KEY: ok,
      }),
    );
    assert.equal(readStrongEnvKey("OAUTH_CREDENTIALS_KEY", { OAUTH_CREDENTIALS_KEY: ok }), ok);
  });
});
