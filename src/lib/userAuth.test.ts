import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deleteUserDeniedReason, userCanAuthenticate } from "./userAuth.js";

describe("userCanAuthenticate", () => {
  it("allows active unlocked users", () => {
    assert.equal(userCanAuthenticate({ deactivatedAt: null, lockedAt: null }), true);
  });

  it("rejects deactivated or locked users", () => {
    const now = new Date();
    assert.equal(userCanAuthenticate({ deactivatedAt: now, lockedAt: null }), false);
    assert.equal(userCanAuthenticate({ deactivatedAt: null, lockedAt: now }), false);
    assert.equal(userCanAuthenticate({ deactivatedAt: now, lockedAt: now }), false);
    assert.equal(
      userCanAuthenticate({ deactivatedAt: now.toISOString(), lockedAt: null }),
      false,
    );
  });
});

describe("deleteUserDeniedReason", () => {
  it("blocks the last remaining user first", () => {
    const denied = deleteUserDeniedReason({
      userCount: 1,
      targetId: 1,
      currentUserId: 1,
      hasRestrictedAuthorship: true,
    });
    assert.equal(denied?.code, "last_user");
  });

  it("blocks deleting the current user", () => {
    const denied = deleteUserDeniedReason({
      userCount: 2,
      targetId: 1,
      currentUserId: 1,
      hasRestrictedAuthorship: false,
    });
    assert.equal(denied?.code, "cannot_delete_self");
  });

  it("blocks users with restricted authorship", () => {
    const denied = deleteUserDeniedReason({
      userCount: 2,
      targetId: 2,
      currentUserId: 1,
      hasRestrictedAuthorship: true,
    });
    assert.equal(denied?.code, "user_has_records");
  });

  it("allows deleting another unused user", () => {
    assert.equal(
      deleteUserDeniedReason({
        userCount: 2,
        targetId: 2,
        currentUserId: 1,
        hasRestrictedAuthorship: false,
      }),
      null,
    );
  });
});
