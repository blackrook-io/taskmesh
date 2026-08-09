import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hashPassword,
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

  it("hashes and verifies", async () => {
    const hash = await hashPassword(STRONG);
    assert.ok(hash.startsWith("scrypt$"));
    assert.equal(await verifyPassword(STRONG, hash), true);
    assert.equal(await verifyPassword("Wrong-Cedar9!xk", hash), false);
  });
});
