import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ideas, todos } from "../db/schema.js";
import { NotFoundError } from "../lib/notFound.js";
import {
  ACCESS_DENIED_CODE,
  OwnershipAccessError,
  dualScopeListFilter,
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

describe("NotFoundError", () => {
  it("uses not_found 404", () => {
    const err = new NotFoundError("Project not found");
    assert.equal(err.status, 404);
    assert.equal(err.code, "not_found");
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

describe("dualScopeListFilter", () => {
  const fakeDb = {
    select() {
      return {
        from() {
          return {
            where() {
              return "owned-ids-subquery";
            },
          };
        },
      };
    },
  } as never;

  it("returns undefined for administrators", () => {
    assert.equal(dualScopeListFilter(fakeDb, todos.projectId, 3, true), undefined);
  });

  it("returns a filter for non-administrators", () => {
    const clause = dualScopeListFilter(fakeDb, todos.projectId, 3, false);
    assert.ok(clause);
  });
});
