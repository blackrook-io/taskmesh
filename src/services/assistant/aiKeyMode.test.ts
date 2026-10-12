import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { billingAckRequired, instanceKeyHint, redactSecret } from "./aiKeyMode.js";

describe("billingAckRequired", () => {
  it("requires the phrase only when entering a shared-spend mode with multiple users", () => {
    assert.equal(
      billingAckRequired({
        current: "user_only",
        next: "instance_only",
        activeUserCount: 2,
      }),
      true,
    );
    assert.equal(
      billingAckRequired({
        current: "instance_only",
        next: "user_preferred_instance_fallback",
        activeUserCount: 3,
      }),
      true,
    );
    assert.equal(
      billingAckRequired({
        current: "user_only",
        next: "instance_only",
        activeUserCount: 1,
      }),
      false,
    );
    assert.equal(
      billingAckRequired({
        current: "instance_only",
        next: "user_only",
        activeUserCount: 4,
      }),
      false,
    );
    assert.equal(
      billingAckRequired({
        current: "instance_only",
        next: "instance_only",
        activeUserCount: 4,
      }),
      false,
    );
  });
});

describe("instance key hint", () => {
  it("keeps the last 4 characters and strips the secret from messages", () => {
    const secret = "sk-unit-test-instance-wxyz";
    assert.equal(instanceKeyHint(`  ${secret}  `), "wxyz");
    assert.equal(redactSecret(`rejected ${secret}`, secret), "rejected [redacted]");
    assert.equal(redactSecret("rejected", secret).includes(secret), false);
  });
});
