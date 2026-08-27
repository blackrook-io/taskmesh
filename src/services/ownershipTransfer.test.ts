import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OWNERSHIP_TRANSFER_ENTITY_TYPES,
  OwnershipTransferValidationError,
} from "./ownershipTransfer.js";
import { projectOwnedListFilter } from "./ownership.js";
import { projects } from "../db/schema.js";

describe("OWNERSHIP_TRANSFER_ENTITY_TYPES", () => {
  it("includes top-level owned entity kinds", () => {
    assert.ok(OWNERSHIP_TRANSFER_ENTITY_TYPES.includes("project"));
    assert.ok(OWNERSHIP_TRANSFER_ENTITY_TYPES.includes("tag"));
    assert.ok(OWNERSHIP_TRANSFER_ENTITY_TYPES.includes("template"));
  });
});

describe("OwnershipTransferValidationError", () => {
  it("uses validation_error 400", () => {
    const err = new OwnershipTransferValidationError("bad");
    assert.equal(err.status, 400);
    assert.equal(err.code, "validation_error");
  });
});

describe("projectOwnedListFilter", () => {
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
    assert.equal(projectOwnedListFilter(fakeDb, projects.id, 3, true), undefined);
  });

  it("returns a filter for non-administrators", () => {
    const clause = projectOwnedListFilter(fakeDb, projects.id, 3, false);
    assert.ok(clause);
  });
});
