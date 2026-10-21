import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import nodemailer from "nodemailer";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { emptyTimeBuckets, type UsageRange } from "../../lib/usageRange.js";
import type { JobContext } from "../jobs/builtin.js";
import { enqueue } from "../jobs/queue.js";
import { JOB_EMAIL_SEND, type MailKind, type MailResult } from "./constants.js";
import { assertSendable, MailError, readMailRuntime, smtpPassword, type MailRuntime } from "./settings.js";

type Db = NodePgDatabase<typeof schema>;

const NOTE_MAX = 2000;

export const outboundMailSchema = z.object({
  to: z.string().trim().email().max(320),
  subject: z.string().trim().min(1).max(500),
  text: z.string().max(100_000),
  html: z.string().max(200_000).optional(),
  kind: z.enum(["outbound", "test"]).default("outbound"),
});

export type OutboundMail = z.infer<typeof outboundMailSchema>;

export type MailTransportOptions = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  ignoreTLS: boolean;
  auth?: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
};

export function mailTransportOptions(runtime: MailRuntime): MailTransportOptions {
  const pass = smtpPassword(runtime);
  const timeoutMs = runtime.timeoutSeconds * 1000;
  return {
    host: runtime.host,
    port: runtime.port,
    secure: runtime.encryption === "tls",
    requireTLS: runtime.encryption === "starttls",
    ignoreTLS: runtime.encryption === "none",
    auth: runtime.username || pass ? { user: runtime.username, pass: pass ?? "" } : undefined,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  };
}

export function redactMailError(err: unknown, secrets: Array<string | null>): string {
  let message = "Mail server error";
  if (err instanceof Error && err.message.trim()) message = err.message.trim();
  for (const secret of secrets) {
    if (secret && secret.length >= 4) message = message.split(secret).join("[redacted]");
  }
  return message.slice(0, NOTE_MAX);
}

function clip(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, NOTE_MAX);
}

export async function writeMailLog(
  database: Db,
  row: {
    result: MailResult;
    toAddress: string;
    subject: string;
    warning?: string | null;
    error?: string | null;
    jobId?: string | null;
    kind: MailKind;
  },
): Promise<void> {
  await database.insert(schema.mailLog).values({
    result: row.result,
    toAddress: row.toAddress.slice(0, 320),
    subject: row.subject.slice(0, 500),
    warning: clip(row.warning),
    error: clip(row.error),
    jobId: row.jobId ?? null,
    kind: row.kind,
  });
}

export async function deliverMail(
  runtime: MailRuntime,
  message: { to: string; subject: string; text: string; html?: string },
): Promise<string | null> {
  const transport = nodemailer.createTransport(mailTransportOptions(runtime));
  try {
    const info = await transport.sendMail({
      from: runtime.fromName
        ? { name: runtime.fromName, address: runtime.fromAddress }
        : runtime.fromAddress,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: runtime.replyTo || undefined,
    });
    const rejected = Array.isArray(info.rejected) ? info.rejected.map(String).filter(Boolean) : [];
    if (rejected.length > 0) {
      throw new MailError(502, "mail_rejected", `Mail server rejected: ${rejected.join(", ")}`);
    }
    return typeof info.response === "string" ? info.response.slice(0, NOTE_MAX) : null;
  } finally {
    transport.close();
  }
}

export async function verifyMailConnection(runtime: MailRuntime): Promise<void> {
  if (!runtime.host) {
    throw new MailError(400, "mail_not_configured", "Set a host before testing the connection.");
  }
  const transport = nodemailer.createTransport(mailTransportOptions(runtime));
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

/**
 * Queue one outbound message. The body stays on the job until it is sent.
 * `mail_log` records the transaction without the body.
 */
export async function enqueueOutboundMail(
  database: Db,
  input: OutboundMail,
): Promise<{ jobId: string }> {
  const parsed = outboundMailSchema.parse(input);
  const runtime = await readMailRuntime(database);
  assertSendable(runtime, parsed.kind);
  let jobId: string | null;
  try {
    jobId = await enqueue(JOB_EMAIL_SEND, {
      to: parsed.to,
      subject: parsed.subject,
      text: parsed.text,
      ...(parsed.html ? { html: parsed.html } : {}),
      kind: parsed.kind,
    });
  } catch (err) {
    await writeMailLog(database, {
      result: "failed",
      toAddress: parsed.to,
      subject: parsed.subject,
      error: "Job queue is not running",
      kind: parsed.kind,
    });
    throw new MailError(503, "job_queue_unavailable", "Job queue is not running");
  }
  if (!jobId) {
    await writeMailLog(database, {
      result: "failed",
      toAddress: parsed.to,
      subject: parsed.subject,
      error: "Job queue did not accept the message",
      kind: parsed.kind,
    });
    throw new MailError(503, "job_queue_unavailable", "Job queue did not accept the message");
  }
  await writeMailLog(database, {
    result: "queued",
    toAddress: parsed.to,
    subject: parsed.subject,
    jobId,
    kind: parsed.kind,
  });
  return { jobId };
}

export async function testMailConnection(database: Db): Promise<void> {
  const runtime = await readMailRuntime(database);
  try {
    await verifyMailConnection(runtime);
    await writeMailLog(database, {
      result: "verified",
      toAddress: "",
      subject: "Connection test",
      kind: "connection",
    });
  } catch (err) {
    const error = redactMailError(err, [runtime.password, runtime.apiToken]);
    await writeMailLog(database, {
      result: "failed",
      toAddress: "",
      subject: "Connection test",
      error,
      kind: "connection",
    });
    if (err instanceof MailError) throw err;
    throw new MailError(502, "mail_connection_failed", error);
  }
}

export async function sendTestMail(database: Db, to: string): Promise<{ jobId: string }> {
  return enqueueOutboundMail(database, {
    to,
    subject: "TaskMesh test message",
    text: "This is a test message from TaskMesh. No action is required.",
    kind: "test",
  });
}

export async function handleEmailSend(data: object, job?: JobContext): Promise<void> {
  const parsed = outboundMailSchema.safeParse(data);
  if (!parsed.success) {
    await writeMailLog(db, {
      result: "failed",
      toAddress: "",
      subject: "",
      error: "Invalid mail job",
      jobId: job?.id,
      kind: "outbound",
    });
    return;
  }
  let runtime: MailRuntime | null = null;
  try {
    runtime = await readMailRuntime(db);
    assertSendable(runtime, parsed.data.kind);
    const warning = await deliverMail(runtime, parsed.data);
    await writeMailLog(db, {
      result: "sent",
      toAddress: parsed.data.to,
      subject: parsed.data.subject,
      warning,
      jobId: job?.id,
      kind: parsed.data.kind,
    });
  } catch (err) {
    const willRetry = job != null && job.retryCount < job.retryLimit;
    await writeMailLog(db, {
      result: willRetry ? "retry" : "failed",
      toAddress: parsed.data.to,
      subject: parsed.data.subject,
      error: redactMailError(err, [runtime?.password ?? null, runtime?.apiToken ?? null]),
      jobId: job?.id,
      kind: parsed.data.kind,
    });
    throw err;
  }
}

export type MailLogRow = {
  id: number;
  createdAt: string;
  result: string;
  toAddress: string;
  subject: string;
  warning: string | null;
  error: string | null;
  kind: string;
};

export async function listMailLog(
  database: Db,
  opts: { limit: number; offset: number; result?: string; since?: Date; q?: string },
): Promise<{ data: MailLogRow[]; total: number }> {
  const filters = [];
  if (opts.result) filters.push(eq(schema.mailLog.result, opts.result));
  if (opts.since) filters.push(gte(schema.mailLog.createdAt, opts.since));
  const q = opts.q?.trim();
  if (q) {
    const pattern = `%${q}%`;
    filters.push(
      or(
        ilike(schema.mailLog.toAddress, pattern),
        ilike(schema.mailLog.subject, pattern),
        ilike(schema.mailLog.warning, pattern),
        ilike(schema.mailLog.error, pattern),
      ),
    );
  }
  const where = filters.length > 0 ? and(...filters) : undefined;
  const [countRow] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.mailLog)
    .where(where);
  const rows = await database
    .select()
    .from(schema.mailLog)
    .where(where)
    .orderBy(desc(schema.mailLog.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
  return {
    total: countRow?.count ?? 0,
    data: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      result: row.result,
      toAddress: row.toAddress,
      subject: row.subject,
      warning: row.warning,
      error: row.error,
      kind: row.kind,
    })),
  };
}

export type MailActivityPoint = {
  t: string;
  sent: number;
  failed: number;
  retries: number;
};

export type MailActivity = {
  range: UsageRange;
  queue: { created: number; active: number; retry: number; failed: number };
  series: MailActivityPoint[];
};

type CountRow = { state: string; n: number };
type ActivityRow = { state: string; completed_on: Date | string; retry_count: number };

export async function getMailActivity(range: UsageRange): Promise<MailActivity> {
  const queue = { created: 0, active: 0, retry: 0, failed: 0 };
  const { bucketStart, step, series } = emptyTimeBuckets(range, (t) => ({
    t: t.toISOString(),
    sent: 0,
    failed: 0,
    retries: 0,
  }));
  try {
    const counts = await db.execute<CountRow>(sql`
      SELECT state, count(*)::int AS n
      FROM pgboss.job
      WHERE name = ${JOB_EMAIL_SEND}
        AND state IN ('created', 'active', 'retry', 'failed')
      GROUP BY state
    `);
    for (const row of counts.rows) {
      const n = Number(row.n);
      if (row.state === "created") queue.created = n;
      else if (row.state === "active") queue.active = n;
      else if (row.state === "retry") queue.retry = n;
      else if (row.state === "failed") queue.failed = n;
    }
    const since = new Date(bucketStart);
    const activity = await db.execute<ActivityRow>(sql`
      SELECT state, completed_on, retry_count
      FROM pgboss.job
      WHERE name = ${JOB_EMAIL_SEND}
        AND state IN ('completed', 'failed')
        AND completed_on >= ${since}
      UNION ALL
      SELECT state, completed_on, retry_count
      FROM pgboss.archive
      WHERE name = ${JOB_EMAIL_SEND}
        AND state IN ('completed', 'failed')
        AND completed_on >= ${since}
    `);
    for (const row of activity.rows) {
      const ms = new Date(row.completed_on).getTime();
      if (!Number.isFinite(ms)) continue;
      const point = series[Math.floor((ms - bucketStart) / step)];
      if (!point) continue;
      if (row.state === "completed") point.sent += 1;
      else if (row.state === "failed") point.failed += 1;
      if (Number(row.retry_count) > 0) point.retries += 1;
    }
  } catch (err) {
    const code = postgresCode(err);
    if (code !== "42P01") throw err;
  }
  return { range, queue, series };
}

function postgresCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if ("code" in current && typeof (current as { code: unknown }).code === "string") {
      return (current as { code: string }).code;
    }
    current = "cause" in current ? (current as { cause: unknown }).cause : null;
  }
  return null;
}
