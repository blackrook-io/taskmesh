import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashPassword } from "../lib/password.js";
import {
  assertPasswordNotReused,
  historyIdsToDelete,
  PASSWORD_REUSED_CODE,
  PASSWORD_REUSED_MESSAGE,
  passwordMatchesAnyHash,
  PRIOR_HISTORY_LIMIT,
} from "./passwordHistory.js";

describe("historyIdsToDelete", () => {
  it("keeps the newest N ids", () => {
    assert.deepEqual(historyIdsToDelete([10, 9, 8, 7, 6, 5], 4), [6, 5]);
    assert.deepEqual(historyIdsToDelete([1, 2, 3, 4], 4), []);
    assert.deepEqual(historyIdsToDelete([], PRIOR_HISTORY_LIMIT), []);
  });
});

describe("passwordMatchesAnyHash / assertPasswordNotReused", () => {
  it("detects a match against current or prior hashes", async () => {
    const a = await hashPassword("AlphaPass1!xyz");
    const b = await hashPassword("BravoPass2!xyz");
    assert.equal(await passwordMatchesAnyHash("AlphaPass1!xyz", [a, b]), true);
    assert.equal(await passwordMatchesAnyHash("CharliePass3!xyz", [a, b]), false);
  });

  it("rejects reuse of the current password", async () => {
    const current = await hashPassword("CurrentPass1!xyz");
    await assert.rejects(
      () => assertPasswordNotReused("CurrentPass1!xyz", current, []),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as { code?: string }).code, PASSWORD_REUSED_CODE);
        assert.equal(err.message, PASSWORD_REUSED_MESSAGE);
        return true;
      },
    );
  });

  it("rejects reuse of a prior history password", async () => {
    const prior = await hashPassword("PriorPass9!xyz");
    await assert.rejects(
      () => assertPasswordNotReused("PriorPass9!xyz", null, [prior]),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, PASSWORD_REUSED_CODE);
        return true;
      },
    );
  });

  it("allows a fresh password", async () => {
    const current = await hashPassword("OldPassAAA1!xyz");
    const prior = await hashPassword("OldPassBBB2!xyz");
    await assertPasswordNotReused("FreshPassCCC3!xyz", current, [prior]);
  });
});
