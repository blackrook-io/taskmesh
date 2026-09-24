import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveBackupSqlPath } from "./backups.js";

describe("resolveBackupSqlPath", () => {
  const dir = "/var/lib/taskmesh/backups/abc";

  it("accepts a plain basename", () => {
    assert.equal(
      resolveBackupSqlPath(dir, "dump.sql"),
      path.resolve(dir, "dump.sql"),
    );
  });

  it("rejects path traversal and absolute paths", () => {
    assert.throws(() => resolveBackupSqlPath(dir, "../etc/passwd"));
    assert.throws(() => resolveBackupSqlPath(dir, "/etc/passwd"));
    assert.throws(() => resolveBackupSqlPath(dir, "nested/dump.sql"));
    assert.throws(() => resolveBackupSqlPath(dir, ".."));
  });
});
