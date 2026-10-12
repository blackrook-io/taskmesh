import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import type { AiAction } from "./aiPolicy.js";

export type AiAuditAction = AiAction | "respond";

export type AiAuditInput = {
  userId?: number | null;
  feature: string;
  provider?: string | null;
  model?: string | null;
  tool?: string | null;
  action: AiAuditAction;
  entityType?: string | null;
  entityId?: number | null;
  projectId?: number | null;
  decision: "allow" | "deny";
  reason?: string | null;
  tier: number;
  tokensIn?: number | null;
  tokensOut?: number | null;
  latencyMs?: number | null;
};

export type AiAuditSink = (row: AiAuditInput) => Promise<void>;

export async function writeAiAudit(row: AiAuditInput, sink?: AiAuditSink): Promise<void> {
  if (sink) {
    await sink(row);
    return;
  }
  await db.insert(schema.aiAuditLog).values({
    userId: row.userId ?? null,
    feature: row.feature,
    provider: row.provider ?? null,
    model: row.model ?? null,
    tool: row.tool ?? null,
    action: row.action,
    entityType: row.entityType ?? null,
    entityId: row.entityId ?? null,
    projectId: row.projectId ?? null,
    decision: row.decision,
    reason: row.reason ?? null,
    tier: row.tier,
    tokensIn: row.tokensIn ?? null,
    tokensOut: row.tokensOut ?? null,
    latencyMs: row.latencyMs ?? null,
  });
}
