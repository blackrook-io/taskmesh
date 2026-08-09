import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashPassword, validatePassword, verifyPassword } from "./password.js";

describe("password", () => {
  it("rejects weak passwords", () => {
    assert.ok(validatePassword("short"));
    assert.ok(validatePassword("nouppercase1!"));
    assert.ok(validatePassword("NOLOWERCASE1!"));
    assert.ok(validatePassword("NoDigits!!!!"));
    assert.ok(validatePassword("NoSymbolssss1"));
  });

  it("accepts a strong password", () => {
    assert.equal(validatePassword("GoodPassw0rd!"), null);
  });

  it("hashes and verifies", async () => {
    const hash = await hashPassword("GoodPassw0rd!");
    assert.ok(hash.startsWith("scrypt$"));
    assert.equal(await verifyPassword("GoodPassw0rd!", hash), true);
    assert.equal(await verifyPassword("WrongPassw0rd!", hash), false);
  });
});
