import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROJECT_USER_ROLES,
  ProjectUsersError,
} from "./projectUsers.js";

describe("PROJECT_USER_ROLES", () => {
  it("lists manager, member, viewer", () => {
    assert.deepEqual([...PROJECT_USER_ROLES], ["manager", "member", "viewer"]);
  });
});

describe("ProjectUsersError", () => {
  it("carries status and code", () => {
    const err = new ProjectUsersError(400, "user_not_usable", "inactive");
    assert.equal(err.status, 400);
    assert.equal(err.code, "user_not_usable");
    assert.equal(err.message, "inactive");
    assert.equal(err.name, "ProjectUsersError");
  });
});
