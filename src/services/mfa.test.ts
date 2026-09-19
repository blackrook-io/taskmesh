import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateTotpSecret, totpUri, verifyTotpCode, buildTotp } from "../lib/totp.js";
import {
  graceDeadline,
  isMfaEnrolled,
  isPastMfaGrace,
} from "../services/mfa.js";

describe("totp", () => {
  it("generates a base32 secret and matching otpauth URI", () => {
    const secret = generateTotpSecret();
    assert.ok(secret.length >= 16);
    const uri = totpUri(secret, "user@example.com");
    assert.match(uri, /^otpauth:\/\/totp\//);
    assert.match(uri, /TaskMesh/);
  });

  it("verifies a current TOTP code", () => {
    const secret = generateTotpSecret();
    const code = buildTotp(secret, "u").generate();
    assert.equal(verifyTotpCode(secret, code), true);
    assert.equal(verifyTotpCode(secret, "000000"), false);
    assert.equal(verifyTotpCode(secret, "abc"), false);
  });
});

describe("mfa grace helpers", () => {
  it("detects enrollment", () => {
    assert.equal(
      isMfaEnrolled({ mfaEnabledAt: new Date(), mfaTotpSecretEnc: "x" }),
      true,
    );
    assert.equal(
      isMfaEnrolled({ mfaEnabledAt: null, mfaTotpSecretEnc: "x" }),
      false,
    );
  });

  it("computes grace deadline and past check", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = graceDeadline(start, 7);
    assert.equal(end.toISOString(), "2026-01-08T00:00:00.000Z");
    assert.equal(isPastMfaGrace(start, 7, new Date("2026-01-07T23:00:00.000Z")), false);
    assert.equal(isPastMfaGrace(start, 7, new Date("2026-01-08T00:00:00.000Z")), true);
    assert.equal(isPastMfaGrace(null, 7, new Date()), false);
  });
});
