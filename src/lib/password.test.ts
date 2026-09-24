import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hashPassword,
  needsPasswordRehash,
  normalizeForPasswordCheck,
  validatePassword,
  verifyPassword,
} from "./password.js";

const STRONG = "Blue-Cedar9!xk";

describe("password", () => {
  it("rejects weak structure", () => {
    assert.ok(validatePassword("short"));
    assert.ok(validatePassword("nouppercase1!"));
    assert.ok(validatePassword("NOLOWERCASE1!"));
    assert.ok(validatePassword("NoDigits!!!!"));
    assert.ok(validatePassword("NoSymbolssss1"));
  });

  it("rejects common words, sequences, and repeats", () => {
    assert.ok(validatePassword("MyPassword1!xx"));
    assert.ok(validatePassword("P@ssw0rd!!!!1"));
    assert.ok(validatePassword("Abcd1234!xyz"));
    assert.ok(validatePassword("Qwerty12!abc"));
    assert.ok(validatePassword("Hello!!!999Aaa"));
  });

  it("accepts a strong password", () => {
    assert.equal(validatePassword(STRONG), null);
  });

  it("normalizes leetspeak for checks", () => {
    assert.ok(normalizeForPasswordCheck("P@ssw0rd").includes("password"));
  });

  it("hashes and verifies with current scrypt N", async () => {
    const hash = await hashPassword(STRONG);
    assert.match(hash, /^scrypt\$131072\$/);
    assert.equal(await verifyPassword(STRONG, hash), true);
    assert.equal(await verifyPassword("Wrong-Cedar9!xk", hash), false);
    assert.equal(needsPasswordRehash(hash), false);
  });

  it("verifies legacy N=16384 hashes and flags rehash", async () => {
    const { randomBytes, scrypt: scryptCb } = await import("node:crypto");
    const salt = randomBytes(16);
    const derived = await new Promise<Buffer>((resolve, reject) => {
      scryptCb(STRONG, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => {
        if (err) reject(err);
        else resolve(key as Buffer);
      });
    });
    const legacy = `scrypt$16384$8$1$${salt.toString("base64")}$${derived.toString("base64")}`;
    assert.equal(await verifyPassword(STRONG, legacy), true);
    assert.equal(needsPasswordRehash(legacy), true);
    assert.equal(await verifyPassword(STRONG, "not-a-hash"), false);
  });

  it("returns false (not throw) when scrypt rejects malformed params", async () => {
    // N=100 is not a power of 2 — Node's scrypt throws; verifyPassword must catch.
    const salt = Buffer.from("saltsaltsaltsalt").toString("base64");
    const hash = Buffer.alloc(64, 1).toString("base64");
    const bad = `scrypt$100$8$1$${salt}$${hash}`;
    assert.equal(await verifyPassword(STRONG, bad), false);
  });
});
