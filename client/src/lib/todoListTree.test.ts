import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TodoListItem } from "../types.ts";
import { classifyTodoDrop, todoDropZoneFromPointer } from "./todoListTree.ts";

function row(partial: {
  id: number;
  entityId?: number;
  parentId?: number | null;
  entityType?: TodoListItem["entityType"];
  virtual?: boolean;
  sortOrder?: number;
}): TodoListItem {
  return {
    id: partial.id,
    listId: 1,
    entityType: partial.entityType ?? "todo",
    entityId: partial.entityId ?? partial.id * 10,
    sortOrder: partial.sortOrder ?? partial.id,
    checked: false,
    createdAt: "",
    updatedAt: "",
    title: String(partial.id),
    href: null,
    state: "ready",
    parentId: partial.parentId ?? null,
    virtual: partial.virtual,
  };
}

/** A, A1, A2, B, B1 */
function tree(): TodoListItem[] {
  return [
    row({ id: 1, entityId: 10 }),
    row({ id: 2, entityId: 20 }),
    row({ id: 3, entityId: 11, parentId: 10 }),
    row({ id: 4, entityId: 12, parentId: 10 }),
    row({ id: 5, entityId: 21, parentId: 20 }),
  ];
}

describe("todoDropZoneFromPointer", () => {
  it("uses the outer bands for reorder and the middle to reparent", () => {
    assert.equal(todoDropZoneFromPointer(10, 0, 100), "before");
    assert.equal(todoDropZoneFromPointer(50, 0, 100), "center");
    assert.equal(todoDropZoneFromPointer(90, 0, 100), "after");
    assert.equal(todoDropZoneFromPointer(0, 0, 0), "center");
  });
});

describe("classifyTodoDrop", () => {
  it("reparents onto the middle of a ToDo and keeps the subtree last among its children", () => {
    const items = tree();
    const action = classifyTodoDrop(items, 1, 2, "center");
    assert.deepEqual(action, {
      kind: "reparent",
      entityId: 10,
      parentId: 20,
      orderedItemIds: [2, 5, 1, 3, 4],
    });
    assert.equal(items[0]?.parentId, null);
  });

  it("reorders on an edge inside the sibling group without changing parent", () => {
    const action = classifyTodoDrop(tree(), 1, 2, "before");
    assert.equal(action.kind, "reorder");
    if (action.kind !== "reorder") return;
    assert.deepEqual(action.orderedItemIds, [2, 5, 1, 3, 4]);
  });

  it("ignores an edge drop into a different sibling group", () => {
    assert.deepEqual(classifyTodoDrop(tree(), 3, 2, "after"), { kind: "ignore" });
  });

  it("clears the parent from the top-level zone and places the row last among roots", () => {
    const action = classifyTodoDrop(tree(), 5, "root", "root");
    assert.deepEqual(action, {
      kind: "reparent",
      entityId: 21,
      parentId: null,
      orderedItemIds: [1, 3, 4, 2, 5],
    });
  });

  it("ignores a top-level drop when the row is already a root", () => {
    assert.deepEqual(classifyTodoDrop(tree(), 1, "root", "root"), { kind: "ignore" });
  });

  it("rejects a drop on itself or a descendant", () => {
    assert.equal(classifyTodoDrop(tree(), 1, 1, "center").kind, "reject");
    assert.equal(classifyTodoDrop(tree(), 1, 3, "center").kind, "reject");
  });

  it("ignores a drop on the current parent", () => {
    assert.deepEqual(classifyTodoDrop(tree(), 3, 1, "center"), { kind: "ignore" });
  });

  it("rejects nesting a task and still reorders it among siblings", () => {
    const items = [...tree(), row({ id: 6, entityId: 60, entityType: "task" })];
    assert.equal(classifyTodoDrop(items, 6, 2, "center").kind, "reject");
    assert.equal(classifyTodoDrop(items, 1, 6, "center").kind, "reject");
    const action = classifyTodoDrop(items, 6, 1, "after");
    assert.equal(action.kind, "reorder");
  });
});
