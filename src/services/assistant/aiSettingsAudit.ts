import type { AiBudgets } from "./aiBudgets.js";
import { writeAiAudit } from "./aiAudit.js";
import type { StoredAiPermissionTiers } from "./aiTiers.js";

export type AiSettingsSnapshot = {
  aiWebFetch: boolean;
  aiProjectAccessDefault: string;
  aiProjectLocalOnly: boolean;
  aiBudgets: AiBudgets;
  aiInstanceUsdPerMillionTokens: number;
  aiPermissionTiers: StoredAiPermissionTiers;
  aiInstructions: string | null;
};

export type AiSettingsTouch = {
  aiWebFetch?: unknown;
  aiProjectAccessDefault?: unknown;
  aiProjectLocalOnly?: unknown;
  aiBudgets?: unknown;
  aiInstanceUsdPerMillionTokens?: unknown;
  aiPermissionTiers?: unknown;
  aiInstructions?: unknown;
};

const PLUGIN_ID = /^[a-z0-9-]+$/;
const SECRET_LIKE = /sk-[A-Za-z0-9_-]{6,}/g;

function budgetParts(before: AiBudgets, after: AiBudgets): string[] {
  const fields: Array<keyof AiBudgets> = [
    "tokensPerUserPerDay",
    "instanceSpendUsdPerDay",
    "toolCallsPerRun",
    "writesPerRun",
  ];
  const parts: string[] = [];
  for (const field of fields) {
    if (before[field] === after[field]) continue;
    const next = after[field] == null ? "off" : String(after[field]);
    parts.push(`${field} ${next}`);
  }
  return parts;
}

function matrixParts(
  before: Record<string, number>,
  after: Record<string, number>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const parts: string[] = [];
  for (const key of [...keys].sort()) {
    if (before[key] === after[key]) continue;
    const from = before[key] === undefined ? "—" : String(before[key]);
    const to = after[key] === undefined ? "—" : String(after[key]);
    parts.push(`${key} ${from}→${to}`);
  }
  return parts;
}

/** Short diff of AI settings that actually changed. Never includes a provider key. */
export function describeAiSettingsChange(
  before: AiSettingsSnapshot,
  after: AiSettingsSnapshot,
  touched: AiSettingsTouch,
): string | null {
  const parts: string[] = [];
  if (touched.aiWebFetch !== undefined && before.aiWebFetch !== after.aiWebFetch) {
    parts.push(`webFetch ${after.aiWebFetch}`);
  }
  if (
    touched.aiProjectAccessDefault !== undefined &&
    before.aiProjectAccessDefault !== after.aiProjectAccessDefault
  ) {
    parts.push(`projectAccess ${after.aiProjectAccessDefault}`);
  }
  if (
    touched.aiProjectLocalOnly !== undefined &&
    before.aiProjectLocalOnly !== after.aiProjectLocalOnly
  ) {
    parts.push(`localOnly ${after.aiProjectLocalOnly}`);
  }
  if (touched.aiBudgets !== undefined) {
    parts.push(...budgetParts(before.aiBudgets, after.aiBudgets));
  }
  if (
    touched.aiInstanceUsdPerMillionTokens !== undefined &&
    before.aiInstanceUsdPerMillionTokens !== after.aiInstanceUsdPerMillionTokens
  ) {
    parts.push(`usdPerMillion ${after.aiInstanceUsdPerMillionTokens}`);
  }
  if (
    touched.aiInstructions !== undefined &&
    before.aiInstructions !== after.aiInstructions
  ) {
    parts.push("instructions updated");
  }
  if (touched.aiPermissionTiers !== undefined) {
    const prev = before.aiPermissionTiers;
    const next = after.aiPermissionTiers;
    if (prev.tier1Enabled !== next.tier1Enabled) {
      parts.push(`tier1Enabled ${next.tier1Enabled}`);
    }
    if (prev.maxRecords !== next.maxRecords) parts.push(`maxRecords ${next.maxRecords}`);
    if (prev.maxProjects !== next.maxProjects) parts.push(`maxProjects ${next.maxProjects}`);
    const cells = matrixParts(prev.matrix, next.matrix);
    if (cells.length > 0) parts.push(`matrix ${cells.join(", ")}`);
  }
  if (parts.length === 0) return null;
  return parts.join("; ").slice(0, 2000);
}

export function providerSettingsReason(
  pluginId: string,
  kind: "saved" | "key_replaced" | "key_removed" | "key_verified",
  enabled?: boolean,
): string {
  const id = PLUGIN_ID.test(pluginId) ? pluginId : "unknown";
  if (kind === "saved") return `plugin ${id} saved enabled=${enabled === true}`;
  if (kind === "key_replaced") return `plugin ${id} key replaced`;
  if (kind === "key_removed") return `plugin ${id} key removed`;
  return `plugin ${id} key verified`;
}

export function redactSettingsReason(reason: string): string {
  return reason.replace(SECRET_LIKE, "[redacted]").slice(0, 2000);
}

export async function writeSettingsAudit(userId: number, reason: string): Promise<void> {
  await writeAiAudit({
    userId,
    feature: "admin",
    action: "settings",
    decision: "allow",
    tier: 0,
    reason: redactSettingsReason(reason),
  });
}
