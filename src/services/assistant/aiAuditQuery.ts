import { and, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import * as schema from "../../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

export const AI_AUDIT_EXPORT_CAP = 5_000;
export const AI_AUDIT_PAGE_MAX = 100;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type AiAuditListQuery = {
  userId?: number;
  feature?: string;
  decision?: "allow" | "deny";
  from?: Date;
  toExclusive?: Date;
  limit: number;
  offset: number;
};

export type AiAuditListRow = {
  id: number;
  createdAt: string;
  userName: string | null;
  feature: string;
  action: string;
  decision: string;
  tier: number;
  reason: string | null;
  record: string | null;
  projectName: string | null;
};

function blankToUndefined(value: unknown): unknown {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

function utcDay(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** `YYYY-MM-DD` as a UTC instant. `end` is the following midnight (exclusive). */
export function parseAuditDay(value: string, end: boolean): Date | null {
  const match = DAY.exec(value.trim());
  if (!match) return null;
  const start = utcDay(Number(match[1]), Number(match[2]), Number(match[3]));
  if (!start) return null;
  if (!end) return start;
  const next = new Date(start.getTime());
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

const filterSchema = z.object({
  userId: z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional()),
  feature: z.preprocess(blankToUndefined, z.string().trim().min(1).max(80).optional()),
  decision: z.preprocess(blankToUndefined, z.enum(["allow", "deny"]).optional()),
  from: z.preprocess(blankToUndefined, z.string().optional()),
  to: z.preprocess(blankToUndefined, z.string().optional()),
  limit: z.preprocess(blankToUndefined, z.coerce.number().int().positive().max(AI_AUDIT_PAGE_MAX).optional()),
  offset: z.preprocess(blankToUndefined, z.coerce.number().int().nonnegative().optional()),
});

export function parseAiAuditListQuery(
  input: unknown,
  options?: { export?: boolean },
): { ok: true; query: AiAuditListQuery } | { ok: false; message: string } {
  const parsed = filterSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, message: "Audit filters are invalid." };
  }
  const from = parsed.data.from ? parseAuditDay(parsed.data.from, false) : undefined;
  const toExclusive = parsed.data.to ? parseAuditDay(parsed.data.to, true) : undefined;
  if (parsed.data.from && !from) return { ok: false, message: "From must be YYYY-MM-DD." };
  if (parsed.data.to && !toExclusive) return { ok: false, message: "To must be YYYY-MM-DD." };
  if (from && toExclusive && from >= toExclusive) {
    return { ok: false, message: "From must be on or before To." };
  }
  return {
    ok: true,
    query: {
      userId: parsed.data.userId,
      feature: parsed.data.feature,
      decision: parsed.data.decision,
      from: from ?? undefined,
      toExclusive: toExclusive ?? undefined,
      limit: options?.export ? AI_AUDIT_EXPORT_CAP : (parsed.data.limit ?? 50),
      offset: options?.export ? 0 : (parsed.data.offset ?? 0),
    },
  };
}

function filters(query: AiAuditListQuery): SQL | undefined {
  const parts: SQL[] = [];
  if (query.userId !== undefined) parts.push(eq(schema.aiAuditLog.userId, query.userId));
  if (query.feature !== undefined) parts.push(eq(schema.aiAuditLog.feature, query.feature));
  if (query.decision !== undefined) parts.push(eq(schema.aiAuditLog.decision, query.decision));
  if (query.from) parts.push(gte(schema.aiAuditLog.createdAt, query.from));
  if (query.toExclusive) parts.push(lt(schema.aiAuditLog.createdAt, query.toExclusive));
  return parts.length > 0 ? and(...parts) : undefined;
}

function recordLabel(entityType: string | null, entityId: number | null): string | null {
  if (!entityType && entityId == null) return null;
  if (entityType && entityId != null) return `${entityType} ${entityId}`;
  return entityType ?? String(entityId);
}

export async function listAiAudit(db: Db, query: AiAuditListQuery): Promise<AiAuditListRow[]> {
  const rows = await db
    .select({
      id: schema.aiAuditLog.id,
      createdAt: schema.aiAuditLog.createdAt,
      userName: schema.users.displayName,
      feature: schema.aiAuditLog.feature,
      action: schema.aiAuditLog.action,
      decision: schema.aiAuditLog.decision,
      tier: schema.aiAuditLog.tier,
      reason: schema.aiAuditLog.reason,
      entityType: schema.aiAuditLog.entityType,
      entityId: schema.aiAuditLog.entityId,
      projectName: schema.projects.name,
    })
    .from(schema.aiAuditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.aiAuditLog.userId))
    .leftJoin(schema.projects, eq(schema.projects.id, schema.aiAuditLog.projectId))
    .where(filters(query))
    .orderBy(desc(schema.aiAuditLog.createdAt), desc(schema.aiAuditLog.id))
    .limit(query.limit)
    .offset(query.offset);
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    userName: row.userName,
    feature: row.feature,
    action: row.action,
    decision: row.decision,
    tier: row.tier,
    reason: row.reason,
    record: recordLabel(row.entityType, row.entityId),
    projectName: row.projectName,
  }));
}

function csvCell(value: string): string {
  let text = value;
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

const CSV_HEADER = "time,user,feature,action,decision,tier,reason,record,project";

export function aiAuditRowsToCsv(rows: AiAuditListRow[]): string {
  const lines = [CSV_HEADER];
  for (const row of rows) {
    lines.push(
      [
        row.createdAt,
        row.userName ?? "",
        row.feature,
        row.action,
        row.decision,
        String(row.tier),
        row.reason ?? "",
        row.record ?? "",
        row.projectName ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
