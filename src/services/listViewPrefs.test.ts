import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultColumnPrefs,
  mergeColumnPrefs,
  validateColumnPrefsInput,
} from "./listViewPrefs.js";
import type { EntityFieldRow } from "./listViewPrefs.js";

function field(
  partial: Partial<EntityFieldRow> & Pick<EntityFieldRow, "id" | "fieldKey">,
): EntityFieldRow {
  return {
    entityType: "task",
    label: partial.fieldKey,
    displayable: true,
    defaultVisible: false,
    defaultSortOrder: partial.id,
    sortable: false,
    scope: null,
    ...partial,
  };
}

describe("mergeColumnPrefs", () => {
  const catalog = [
    field({ id: 1, fieldKey: "number", defaultVisible: true, defaultSortOrder: 10 }),
    field({ id: 2, fieldKey: "title", defaultVisible: true, defaultSortOrder: 20 }),
    field({ id: 3, fieldKey: "phase", defaultVisible: false, defaultSortOrder: 30 }),
  ];

  it("builds defaults when stored is null", () => {
    assert.deepEqual(defaultColumnPrefs(catalog), [
      { fieldKey: "number", visible: true },
      { fieldKey: "title", visible: true },
      { fieldKey: "phase", visible: false },
    ]);
  });

  it("keeps stored order and appends new catalog fields", () => {
    const merged = mergeColumnPrefs(catalog, [
      { fieldKey: "title", visible: false },
      { fieldKey: "number", visible: true },
      { fieldKey: "ghost", visible: true },
    ]);
    assert.deepEqual(merged, [
      { fieldKey: "title", visible: false },
      { fieldKey: "number", visible: true },
      { fieldKey: "phase", visible: false },
    ]);
  });
});

describe("validateColumnPrefsInput", () => {
  const catalog = [
    field({ id: 1, fieldKey: "number", defaultVisible: true }),
    field({ id: 2, fieldKey: "title", defaultVisible: true }),
  ];

  it("rejects unknown field keys", () => {
    assert.throws(
      () => validateColumnPrefsInput(catalog, [{ fieldKey: "nope", visible: true }]),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, "validation_error");
        return true;
      },
    );
  });

  it("fills missing catalog fields from defaults", () => {
    const out = validateColumnPrefsInput(catalog, [{ fieldKey: "title", visible: false }]);
    assert.deepEqual(out, [
      { fieldKey: "title", visible: false },
      { fieldKey: "number", visible: true },
    ]);
  });
});
