import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { useSecureCookies } from "./sessionCookie.js";

describe("useSecureCookies", () => {
  it("defaults to Secure in production", () => {
    assert.equal(useSecureCookies({ NODE_ENV: "production" }), true);
  });

  it("defaults to non-Secure outside production", () => {
    assert.equal(useSecureCookies({ NODE_ENV: "development" }), false);
    assert.equal(useSecureCookies({}), false);
  });

  it("honors COOKIE_SECURE override", () => {
    assert.equal(useSecureCookies({ NODE_ENV: "production", COOKIE_SECURE: "false" }), false);
    assert.equal(useSecureCookies({ NODE_ENV: "development", COOKIE_SECURE: "true" }), true);
    assert.equal(useSecureCookies({ NODE_ENV: "production", COOKIE_SECURE: "0" }), false);
  });
});
