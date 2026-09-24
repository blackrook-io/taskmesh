import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ideas,
  projectMembers,
  projectMemberGroups,
  projectManagerGroups,
  projectViewers,
  projectViewerGroups,
  todos,
} from "../db/schema.js";
import { NotFoundError } from "../lib/notFound.js";
import {
  ACCESS_DENIED_CODE,
  OwnershipAccessError,
  dualScopeListFilter,
  dualScopeWriteFilter,
  isAdminOrOwner,
  ownerScope,
  projectAccessListFilter,
  projectOwnedListFilter,
  projectWriteListFilter,
  roleSatisfiesAccess,
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
              return "subquery";
            },
          };
        },
      };
    },
  } as never;

  it("returns undefined for administrators", () => {
    assert.equal(
      dualScopeListFilter(fakeDb, todos.projectId, todos.ownerId, 3, true),
      undefined,
    );
  });

  it("returns a filter for non-administrators (unsorted owned OR accessible projects)", () => {
    const clause = dualScopeListFilter(
      fakeDb,
      todos.projectId,
      todos.ownerId,
      3,
      false,
    );
    assert.ok(clause);
  });
});

/**
 * Records which tables a filter consults, so a write-level filter can be
 * proven never to read from the viewer role lists (T0143).
 */
function recordingDb() {
  const tables: unknown[] = [];
  const db = {
    select() {
      return {
        from(table: unknown) {
          tables.push(table);
          return {
            where() {
              return "subquery";
            },
          };
        },
      };
    },
  } as never;
  return { db, tables };
}

describe("projectWriteListFilter (T0143)", () => {
  it("returns undefined for administrators", () => {
    const { db } = recordingDb();
    assert.equal(projectWriteListFilter(db, 3, true), undefined);
  });

  it("never consults the viewer role lists", () => {
    const { db, tables } = recordingDb();
    const clause = projectWriteListFilter(db, 3, false);
    assert.ok(clause);
    assert.ok(
      !tables.includes(projectViewers),
      "write filter must not grant access via project_viewers",
    );
    assert.ok(
      !tables.includes(projectViewerGroups),
      "write filter must not grant access via project_viewer_groups",
    );
  });

  it("still grants access through member lists", () => {
    const { db, tables } = recordingDb();
    projectWriteListFilter(db, 3, false);
    assert.ok(tables.includes(projectMembers));
  });

  it("is strictly narrower than the read filter", () => {
    const read = recordingDb();
    projectAccessListFilter(read.db, 3, false);
    const write = recordingDb();
    projectWriteListFilter(write.db, 3, false);
    assert.ok(
      write.tables.length < read.tables.length,
      "write filter should consult fewer sources than the read filter",
    );
    assert.ok(read.tables.includes(projectViewers));
  });
});

describe("dualScopeWriteFilter (T0143)", () => {
  it("returns undefined for administrators", () => {
    const { db } = recordingDb();
    assert.equal(
      dualScopeWriteFilter(db, todos.projectId, todos.ownerId, 3, true),
      undefined,
    );
  });

  it("never consults the viewer role lists", () => {
    const { db, tables } = recordingDb();
    const clause = dualScopeWriteFilter(db, todos.projectId, todos.ownerId, 3, false);
    assert.ok(clause);
    assert.ok(
      !tables.includes(projectViewers),
      "dual-scope write filter must not grant access via project_viewers",
    );
    assert.ok(
      !tables.includes(projectViewerGroups),
      "dual-scope write filter must not grant access via project_viewer_groups",
    );
  });

  it("includes manager and member groups (T0148)", () => {
    const { db, tables } = recordingDb();
    dualScopeWriteFilter(db, todos.projectId, todos.ownerId, 3, false);
    assert.ok(tables.includes(projectManagerGroups));
    assert.ok(tables.includes(projectMemberGroups));
  });

  it("is narrower than the dual-scope read filter", () => {
    const read = recordingDb();
    dualScopeListFilter(read.db, todos.projectId, todos.ownerId, 3, false);
    const write = recordingDb();
    dualScopeWriteFilter(write.db, todos.projectId, todos.ownerId, 3, false);
    assert.ok(write.tables.length < read.tables.length);
    assert.ok(read.tables.includes(projectViewers));
    assert.ok(read.tables.includes(projectViewerGroups));
  });
});

describe("group access in list filters (T0148)", () => {
  it("dualScopeListFilter consults viewer groups", () => {
    const { db, tables } = recordingDb();
    dualScopeListFilter(db, todos.projectId, todos.ownerId, 3, false);
    assert.ok(tables.includes(projectViewerGroups));
    assert.ok(tables.includes(projectManagerGroups));
    assert.ok(tables.includes(projectMemberGroups));
  });

  it("projectOwnedListFilter consults viewer groups", () => {
    const { db, tables } = recordingDb();
    projectOwnedListFilter(db, todos.projectId, 3, false);
    assert.ok(tables.includes(projectViewerGroups));
    assert.ok(tables.includes(projectManagerGroups));
    assert.ok(tables.includes(projectMemberGroups));
  });
});

describe("roleSatisfiesAccess", () => {
  it("allows viewers only for read", () => {
    assert.equal(roleSatisfiesAccess("viewer", "read"), true);
    assert.equal(roleSatisfiesAccess("viewer", "write"), false);
    assert.equal(roleSatisfiesAccess("viewer", "settings"), false);
  });

  it("allows members for read and write but not settings", () => {
    assert.equal(roleSatisfiesAccess("member", "read"), true);
    assert.equal(roleSatisfiesAccess("member", "write"), true);
    assert.equal(roleSatisfiesAccess("member", "settings"), false);
  });

  it("allows managers for settings", () => {
    assert.equal(roleSatisfiesAccess("manager", "settings"), true);
    assert.equal(roleSatisfiesAccess("owner", "settings"), true);
    assert.equal(roleSatisfiesAccess("admin", "settings"), true);
  });
});
