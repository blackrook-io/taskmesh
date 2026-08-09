import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findImmutableFields,
  findImmutableFieldsWithValues,
  hasDefinedKeys,
  ImmutableFieldError,
  rejectImmutableFields,
  rejectImmutableImportRow,
} from "./immutableFields.js";

describe("immutableFields", () => {
  it("finds camelCase and snake_case keys", () => {
    assert.deepEqual(
      findImmutableFields({
        title: "x",
        createdAt: "2020-01-01",
        created_by_id: 1,
        number: 9,
      }).sort(),
      ["createdAt", "created_by_id", "number"],
    );
  });

  it("rejects any presence on JSON bodies including null", () => {
    assert.throws(
      () => rejectImmutableFields({ updatedAt: null }),
      (err: unknown) =>
        err instanceof ImmutableFieldError &&
        err.code === "immutable_field" &&
        err.fields.includes("updatedAt"),
    );
  });

  it("allows bodies without immutable keys", () => {
    assert.doesNotThrow(() => rejectImmutableFields({ title: "ok", state: "new" }));
    assert.doesNotThrow(() => rejectImmutableFields(undefined));
    assert.doesNotThrow(() => rejectImmutableFields([]));
  });

  it("import helper ignores blank values but rejects set values", () => {
    assert.deepEqual(
      findImmutableFieldsWithValues({
        title: "t",
        number: "",
        createdAt: null,
        updatedAt: "2020-01-01T00:00:00.000Z",
      }),
      ["updatedAt"],
    );
    assert.doesNotThrow(() =>
      rejectImmutableImportRow({ title: "t", number: "", createdAt: "" }),
    );
    assert.throws(
      () => rejectImmutableImportRow({ title: "t", number: 42 }),
      ImmutableFieldError,
    );
  });

  it("hasDefinedKeys detects optional patch fields", () => {
    assert.equal(hasDefinedKeys({ title: "a" }, ["title", "body"]), true);
    assert.equal(hasDefinedKeys({ body: null }, ["title", "body"]), true);
    assert.equal(hasDefinedKeys({}, ["title", "body"]), false);
  });
});
