import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import type { AiAction } from "./aiPolicy.js";

export type AiAuditAction = AiAction | "respond" | "key_mode";

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

export type AiAuditSink = (row: AiAuditInput) => Promise<number | void>;

/** Inserts one audit row and returns its id. A test sink may return an id or nothing. */
export async function writeAiAudit(row: AiAuditInput, sink?: AiAuditSink): Promise<number | null> {
  if (sink) {
    const id = await sink(row);
    return typeof id === "number" ? id : null;
  }
  const [inserted] = await db.insert(schema.aiAuditLog).values({
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
  }).returning({ id: schema.aiAuditLog.id });
  return inserted?.id ?? null;
}
