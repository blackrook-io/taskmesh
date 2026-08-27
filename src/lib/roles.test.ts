import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAdministratorFromRoles,
  lastAdministratorDenied,
  slugFromRoleName,
} from "./roles.js";

describe("slugFromRoleName", () => {
  it("hyphenates and lowercases", () => {
    assert.equal(slugFromRoleName("  Project Lead  "), "project-lead");
    assert.equal(slugFromRoleName("Administrator"), "administrator");
  });

  it("drops punctuation and empty leftover", () => {
    assert.equal(slugFromRoleName("!!!"), "");
    assert.equal(slugFromRoleName("QA / Ops"), "qa-ops");
  });
});

describe("isAdministratorFromRoles", () => {
  it("matches administrator slug only", () => {
    assert.equal(isAdministratorFromRoles([{ slug: "editor" }]), false);
    assert.equal(
      isAdministratorFromRoles([{ slug: "editor" }, { slug: "administrator" }]),
      true,
    );
  });
});

describe("lastAdministratorDenied", () => {
  it("returns 409 last_administrator for each action", () => {
    const denied = lastAdministratorDenied("remove");
    assert.equal(denied.status, 409);
    assert.equal(denied.code, "last_administrator");
    assert.match(denied.message, /last Administrator/);
    assert.equal(lastAdministratorDenied("lock").code, "last_administrator");
  });
});
