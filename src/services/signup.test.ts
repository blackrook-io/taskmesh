import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { confirmEmailSignup, hashConfirmToken, signupDisplayName } from "./signup.js";

type Db = NodePgDatabase<typeof schema>;

type ConfirmUser = {
  id: number;
  emailConfirmTokenHash: string | null;
  emailConfirmExpiresAt: Date | null;
  deactivatedAt: Date | null;
  emailVerifiedAt: Date | null;
};

const COLUMN_FIELD: Record<string, keyof ConfirmUser> = {
  id: "id",
  email_confirm_token_hash: "emailConfirmTokenHash",
};

/** Pull `column = value` pairs out of a Drizzle `eq` / `and` expression. */
function columnEquals(node: unknown): Map<keyof ConfirmUser, unknown> {
  const pairs = new Map<keyof ConfirmUser, unknown>();
  let column: keyof ConfirmUser | null = null;
  const walk = (current: unknown) => {
    if (!current || typeof current !== "object") return;
    const rec = current as { queryChunks?: unknown[]; name?: string; value?: unknown };
    const ctor = (current as { constructor?: { name?: string } }).constructor?.name ?? "";
    if (ctor === "Param" && column) {
      pairs.set(column, rec.value);
      column = null;
      return;
    }
    if (typeof rec.name === "string" && ctor.startsWith("Pg")) {
      column = COLUMN_FIELD[rec.name] ?? null;
      return;
    }
    if (rec.queryChunks) {
      for (const chunk of rec.queryChunks) walk(chunk);
    }
  };
  walk(node);
  return pairs;
}

function matches(user: ConfirmUser, where: unknown): boolean {
  for (const [field, value] of columnEquals(where)) {
    if (user[field] !== value) return false;
  }
  return true;
}

/** Just enough of the query builder for `confirmEmailSignup`. */
function memoryDb(rows: ConfirmUser[]): Db {
  return {
    select() {
      const query = {
        from() {
          return query;
        },
        where(predicate: unknown) {
          query.predicate = predicate;
          return query;
        },
        async limit() {
          return rows.filter((row) => matches(row, query.predicate)).slice(0, 1);
        },
        predicate: undefined as unknown,
      };
      return query;
    },
    update() {
      const query = {
        set(values: Partial<ConfirmUser>) {
          query.values = values;
          return query;
        },
        where(predicate: unknown) {
          query.predicate = predicate;
          return query;
        },
        async returning() {
          const hit = rows.find((row) => matches(row, query.predicate));
          if (!hit) return [];
          Object.assign(hit, query.values);
          return [{ id: hit.id }];
        },
        values: {} as Partial<ConfirmUser>,
        predicate: undefined as unknown,
      };
      return query;
    },
  } as unknown as Db;
}

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
    const token = "t0129-token";
    const user: ConfirmUser = {
      id: 1,
      emailConfirmTokenHash: hashConfirmToken(token),
      emailConfirmExpiresAt: new Date(Date.now() + 60_000),
      deactivatedAt: null,
      emailVerifiedAt: null,
    };
    const db = memoryDb([user]);
    const result = await confirmEmailSignup(db, token);
    assert.deepEqual(result, { confirmed: true });
    assert.ok(user.emailVerifiedAt);
    assert.equal(user.emailConfirmTokenHash, null);
    await assert.rejects(() => confirmEmailSignup(db, token), (err: Error & { code?: string }) => {
      assert.equal(err.code, "invalid_token");
      return true;
    });
  });

  it("rejects an expired confirmation link", async () => {
    const token = "t0129-expired";
    const user: ConfirmUser = {
      id: 2,
      emailConfirmTokenHash: hashConfirmToken(token),
      emailConfirmExpiresAt: new Date(Date.now() - 1000),
      deactivatedAt: null,
      emailVerifiedAt: null,
    };
    const db = memoryDb([user]);
    await assert.rejects(() => confirmEmailSignup(db, token), (err: Error & { code?: string }) => {
      assert.equal(err.code, "invalid_token");
      return true;
    });
    assert.equal(user.emailVerifiedAt, null);
    assert.equal(user.emailConfirmTokenHash, hashConfirmToken(token));
  });
});
