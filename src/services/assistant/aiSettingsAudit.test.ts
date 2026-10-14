import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_AI_BUDGETS } from "./aiBudgets.js";
import { defaultStoredAiPermissionTiers } from "./aiTiers.js";
import {
  describeAiSettingsChange,
  providerSettingsReason,
  redactSettingsReason,
  type AiSettingsSnapshot,
} from "./aiSettingsAudit.js";

function snapshot(patch: Partial<AiSettingsSnapshot> = {}): AiSettingsSnapshot {
  return {
    aiWebFetch: false,
    aiProjectAccessDefault: "full",
    aiProjectLocalOnly: false,
    aiBudgets: { ...EMPTY_AI_BUDGETS },
    aiInstanceUsdPerMillionTokens: 1,
    aiPermissionTiers: defaultStoredAiPermissionTiers(),
    ...patch,
  };
}

describe("AI settings audit reasons", () => {
  it("names the field that changed and omits a provider key", () => {
    const before = snapshot();
    const after = snapshot({ aiWebFetch: true });
    const reason = describeAiSettingsChange(before, after, {
      aiWebFetch: true,
      aiBudgets: { tokensPerUserPerDay: null, note: "sk-abcdefghijklmnopqrstuvwxyz" },
    });
    assert.equal(reason, "webFetch true");
    assert.doesNotMatch(reason ?? "", /sk-/);
  });

  it("skips a save that does not change a touched field", () => {
    const current = snapshot();
    assert.equal(describeAiSettingsChange(current, current, { aiWebFetch: false }), null);
  });

  it("describes a tier override without copying unrelated text", () => {
    const before = snapshot();
    const after = snapshot({
      aiPermissionTiers: {
        ...defaultStoredAiPermissionTiers(),
        matrix: { ...defaultStoredAiPermissionTiers().matrix, "read:task": 2 },
      },
    });
    const reason = describeAiSettingsChange(before, after, { aiPermissionTiers: {} });
    assert.equal(reason, "matrix read:task —→2");
  });

  it("names the plugin and the kind of key change", () => {
    const reason = providerSettingsReason("openai", "key_replaced");
    assert.equal(reason, "plugin openai key replaced");
    assert.equal(
      redactSettingsReason(`${reason} sk-abcdefghijklmnopqrstuvwxyz`),
      "plugin openai key replaced [redacted]",
    );
  });
});
