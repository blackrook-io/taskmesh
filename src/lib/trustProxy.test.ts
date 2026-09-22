import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTrustProxy } from "./trustProxy.js";

describe("parseTrustProxy", () => {
  it("defaults to false when unset or empty", () => {
    assert.equal(parseTrustProxy({}), false);
    assert.equal(parseTrustProxy({ TRUST_PROXY: "" }), false);
    assert.equal(parseTrustProxy({ TRUST_PROXY: "  " }), false);
  });

  it("parses boolean-like and hop-count forms", () => {
    assert.equal(parseTrustProxy({ TRUST_PROXY: "true" }), 1);
    assert.equal(parseTrustProxy({ TRUST_PROXY: "YES" }), 1);
    assert.equal(parseTrustProxy({ TRUST_PROXY: "1" }), 1);
    assert.equal(parseTrustProxy({ TRUST_PROXY: "2" }), 2);
    assert.equal(parseTrustProxy({ TRUST_PROXY: "false" }), false);
    assert.equal(parseTrustProxy({ TRUST_PROXY: "0" }), false);
    assert.equal(parseTrustProxy({ TRUST_PROXY: "off" }), false);
  });

  it("passes through Express string forms", () => {
    assert.equal(parseTrustProxy({ TRUST_PROXY: "loopback" }), "loopback");
  });

  it("does not infer from NODE_ENV", () => {
    assert.equal(parseTrustProxy({ NODE_ENV: "production" }), false);
  });
});
