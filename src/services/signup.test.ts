import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import * as schema from "../db/schema.js";
import {
  confirmEmailSignup,
  hashConfirmToken,
  signupDisplayName,
} from "./signup.js";
import { allocateUserNumber } from "./users.js";

describe("signup helpers", () => {
  it("hashes the confirmation token and does not store it as itself", () => {
    const token = "signup-token-value";
    const hash = hashConfirmToken(token);
    assert.equal(hash.length, 64);
    assert.equal(hash, hashConfirmToken(token));
    assert.equal(hash.includes(token), false);
  });

  it("builds a display name from the mailbox name", () => {
    assert.equal(signupDisplayName("Ada.Lovelace@Example.com"), "Ada.Lovelace");
    assert.equal(signupDisplayName("@@@example.com"), "User");
  });
});

describe("confirmEmailSignup", () => {
  it("activates a pending account and rejects a reused or expired link", async () => {
    const number = await allocateUserNumber(db);
    const stamp = Date.now();
    const token = `t0129-token-${stamp}`;
    const [user] = await db
      .insert(schema.users)
      .values({
        number,
        displayName: `t0129-${stamp}`,
        email: `t0129-${stamp}@example.test`,
        emailVerifiedAt: null,
        emailConfirmTokenHash: hashConfirmToken(token),
        emailConfirmExpiresAt: new Date(Date.now() + 60_000),
      })
      .returning({ id: schema.users.id });
    assert.ok(user);
    try {
      const result = await confirmEmailSignup(db, token);
      assert.deepEqual(result, { confirmed: true });
      const [row] = await db
        .select({
          emailVerifiedAt: schema.users.emailVerifiedAt,
          emailConfirmTokenHash: schema.users.emailConfirmTokenHash,
        })
        .from(schema.users)
        .where(eq(schema.users.id, user.id))
        .limit(1);
      assert.ok(row?.emailVerifiedAt);
      assert.equal(row?.emailConfirmTokenHash, null);
      await assert.rejects(() => confirmEmailSignup(db, token), (err: Error & { code?: string }) => {
        assert.equal(err.code, "invalid_token");
        return true;
      });
    } finally {
      await db.delete(schema.users).where(eq(schema.users.id, user.id));
    }
  });

  it("rejects an expired confirmation link", async () => {
    const number = await allocateUserNumber(db);
    const stamp = Date.now();
    const token = `t0129-expired-${stamp}`;
    const [user] = await db
      .insert(schema.users)
      .values({
        number,
        displayName: `t0129-expired-${stamp}`,
        email: `t0129-expired-${stamp}@example.test`,
        emailConfirmTokenHash: hashConfirmToken(token),
        emailConfirmExpiresAt: new Date(Date.now() - 1000),
      })
      .returning({ id: schema.users.id });
    assert.ok(user);
    try {
      await assert.rejects(() => confirmEmailSignup(db, token), (err: Error & { code?: string }) => {
        assert.equal(err.code, "invalid_token");
        return true;
      });
      const [row] = await db
        .select({ emailVerifiedAt: schema.users.emailVerifiedAt })
        .from(schema.users)
        .where(eq(schema.users.id, user.id))
        .limit(1);
      assert.equal(row?.emailVerifiedAt, null);
    } finally {
      await db.delete(schema.users).where(eq(schema.users.id, user.id));
    }
  });
});
