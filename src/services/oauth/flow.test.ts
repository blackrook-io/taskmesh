import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeOauthReturnTo } from "./flow.js";

describe("safeOauthReturnTo", () => {
  it("allows same-origin relative paths", () => {
    assert.equal(safeOauthReturnTo("/projects/4"), "/projects/4");
    assert.equal(safeOauthReturnTo("/settings/profile"), "/settings/profile");
  });

  it("rejects open redirects", () => {
    assert.equal(safeOauthReturnTo("https://evil.example"), "/");
    assert.equal(safeOauthReturnTo("//evil.example"), "/");
    assert.equal(safeOauthReturnTo("/login"), "/");
    assert.equal(safeOauthReturnTo(null), "/");
  });
});
