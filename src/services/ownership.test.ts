import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ideas } from "../db/schema.js";
import {
  ACCESS_DENIED_CODE,
  OwnershipAccessError,
  isAdminOrOwner,
  ownerScope,
} from "./ownership.js";

describe("isAdminOrOwner", () => {
  it("allows the owner", () => {
    assert.equal(isAdminOrOwner(false, 7, 7), true);
  });

  it("allows administrators for any owner", () => {
    assert.equal(isAdminOrOwner(true, 1, 99), true);
  });

  it("denies non-admin non-owners", () => {
    assert.equal(isAdminOrOwner(false, 2, 99), false);
  });
});

describe("OwnershipAccessError", () => {
  it("uses access_denied 403", () => {
    const err = new OwnershipAccessError();
    assert.equal(err.status, 403);
    assert.equal(err.code, ACCESS_DENIED_CODE);
  });
});

describe("ownerScope", () => {
  it("returns undefined for administrators (no filter)", () => {
    assert.equal(ownerScope(ideas.ownerId, 3, true), undefined);
  });

  it("returns an eq filter for non-administrators", () => {
    const clause = ownerScope(ideas.ownerId, 3, false);
    assert.ok(clause);
  });
});
