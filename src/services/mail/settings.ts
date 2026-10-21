import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import * as schema from "../../db/schema.js";
import {
  decryptMailSecret,
  encryptMailSecret,
  hasMailCredentialsKey,
} from "../../lib/mailCrypto.js";
import { MAIL_ENCRYPTIONS, type MailEncryption } from "./constants.js";

type Db = NodePgDatabase<typeof schema>;

export class MailError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "MailError";
    this.status = status;
    this.code = code;
  }
}

const emailSchema = z.string().trim().email().max(320);

export function isMailHost(value: string): boolean {
  if (!value || value.length > 253 || value.includes("..")) return false;
  if (
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(
      value,
    )
  ) {
    return true;
  }
  return /^\[[0-9A-Fa-f:.]+\]$/.test(value);
}

export const mailPatchSchema = z
  .object({
    enabled: z.boolean(),
    selfSignupEnabled: z.boolean(),
    host: z.string().trim().max(253),
    port: z.number().int().min(1).max(65535),
    encryption: z.enum(MAIL_ENCRYPTIONS),
    username: z.string().trim().max(320),
    password: z.string().max(4096).optional(),
    clearPassword: z.boolean().optional(),
    apiToken: z.string().max(4096).optional(),
    clearApiToken: z.boolean().optional(),
    fromAddress: z.string().trim().max(320),
    fromName: z.string().trim().max(200),
    replyTo: z.string().trim().max(320),
    timeoutSeconds: z.number().int().min(1).max(120),
  })
  .superRefine((value, ctx) => {
    if (value.password?.trim() && value.clearPassword) {
      ctx.addIssue({
        code: "custom",
        message: "Remove the password or replace it, not both.",
        path: ["password"],
      });
    }
    if (value.apiToken?.trim() && value.clearApiToken) {
      ctx.addIssue({
        code: "custom",
        message: "Remove the API token or replace it, not both.",
        path: ["apiToken"],
      });
    }
    if (value.host && !isMailHost(value.host)) {
      ctx.addIssue({
        code: "custom",
        message: "Host must be a hostname or IP address.",
        path: ["host"],
      });
    }
    if (value.fromAddress && !emailSchema.safeParse(value.fromAddress).success) {
      ctx.addIssue({
        code: "custom",
        message: "From address must be an email address.",
        path: ["fromAddress"],
      });
    }
    if (value.replyTo && !emailSchema.safeParse(value.replyTo).success) {
      ctx.addIssue({
        code: "custom",
        message: "Reply-to must be an email address.",
        path: ["replyTo"],
      });
    }
    if (value.enabled && !value.host) {
      ctx.addIssue({
        code: "custom",
        message: "Host is required when email is enabled.",
        path: ["host"],
      });
    }
    if (value.enabled && !value.fromAddress) {
      ctx.addIssue({
        code: "custom",
        message: "From address is required when email is enabled.",
        path: ["fromAddress"],
      });
    }
    if (value.selfSignupEnabled && !value.enabled) {
      ctx.addIssue({
        code: "custom",
        message: "Turn on outbound email before allowing self-signup.",
        path: ["selfSignupEnabled"],
      });
    }
    if (value.selfSignupEnabled && (!value.host || !value.fromAddress)) {
      ctx.addIssue({
        code: "custom",
        message: "Host and From address are required before allowing self-signup.",
        path: ["selfSignupEnabled"],
      });
    }
  });

export type MailPatch = z.infer<typeof mailPatchSchema>;

export type MailPublic = {
  enabled: boolean;
  selfSignupEnabled: boolean;
  host: string;
  port: number;
  encryption: MailEncryption;
  username: string;
  passwordSet: boolean;
  passwordHint: string | null;
  apiTokenSet: boolean;
  apiTokenHint: string | null;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  timeoutSeconds: number;
  credentialsKeyConfigured: boolean;
  updatedAt: string | null;
};

export type MailRuntime = {
  enabled: boolean;
  host: string;
  port: number;
  encryption: MailEncryption;
  username: string;
  password: string | null;
  apiToken: string | null;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  timeoutSeconds: number;
};

type MailRow = typeof schema.mailSettings.$inferSelect;

/** Last 4 characters when the secret is long enough that the hint is not the secret. */
export function secretHint(value: string): string | null {
  if (value.length <= 4) return null;
  return value.slice(-4);
}

export function toMailPublic(row: MailRow, credentialsKeyConfigured: boolean): MailPublic {
  const encryption = MAIL_ENCRYPTIONS.includes(row.encryption as MailEncryption)
    ? (row.encryption as MailEncryption)
    : "starttls";
  return {
    enabled: row.enabled,
    selfSignupEnabled: row.selfSignupEnabled,
    host: row.host,
    port: row.port,
    encryption,
    username: row.username,
    passwordSet: Boolean(row.passwordEnc),
    passwordHint: row.passwordHint,
    apiTokenSet: Boolean(row.apiTokenEnc),
    apiTokenHint: row.apiTokenHint,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    replyTo: row.replyTo,
    timeoutSeconds: row.timeoutSeconds,
    credentialsKeyConfigured,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

/** SMTP password: the saved password, or the API token when the password is blank. */
export function smtpPassword(runtime: Pick<MailRuntime, "password" | "apiToken">): string | null {
  if (runtime.password) return runtime.password;
  if (runtime.apiToken) return runtime.apiToken;
  return null;
}

async function ensureMailSettings(db: Db): Promise<MailRow> {
  const [row] = await db.select().from(schema.mailSettings).where(eq(schema.mailSettings.id, 1)).limit(1);
  if (row) return row;
  const [created] = await db.insert(schema.mailSettings).values({ id: 1 }).returning();
  if (!created) throw new MailError(500, "mail_settings_missing", "Mail settings could not be created.");
  return created;
}

export async function getMailSettingsPublic(db: Db): Promise<MailPublic> {
  const row = await ensureMailSettings(db);
  return toMailPublic(row, hasMailCredentialsKey());
}

function nextSecret(input: {
  next: string | undefined;
  clear: boolean | undefined;
  existingEnc: string | null;
  existingHint: string | null;
}): { enc: string | null; hint: string | null } {
  if (input.clear) return { enc: null, hint: null };
  const raw = input.next?.trim() ?? "";
  if (!raw) return { enc: input.existingEnc, hint: input.existingHint };
  if (!hasMailCredentialsKey()) {
    throw new MailError(
      400,
      "mail_key_missing",
      "Set EMAIL_CREDENTIALS_KEY before saving a password or API token.",
    );
  }
  return { enc: encryptMailSecret(raw), hint: secretHint(raw) };
}

export async function saveMailSettings(
  db: Db,
  patch: MailPatch,
  updatedById: number | null,
): Promise<MailPublic> {
  const existing = await ensureMailSettings(db);
  const password = nextSecret({
    next: patch.password,
    clear: patch.clearPassword,
    existingEnc: existing.passwordEnc,
    existingHint: existing.passwordHint,
  });
  const apiToken = nextSecret({
    next: patch.apiToken,
    clear: patch.clearApiToken,
    existingEnc: existing.apiTokenEnc,
    existingHint: existing.apiTokenHint,
  });
  const now = new Date();
  const [saved] = await db
    .update(schema.mailSettings)
    .set({
      enabled: patch.enabled,
      selfSignupEnabled: patch.selfSignupEnabled,
      host: patch.host,
      port: patch.port,
      encryption: patch.encryption,
      username: patch.username,
      passwordEnc: password.enc,
      passwordHint: password.hint,
      apiTokenEnc: apiToken.enc,
      apiTokenHint: apiToken.hint,
      fromAddress: patch.fromAddress,
      fromName: patch.fromName,
      replyTo: patch.replyTo,
      timeoutSeconds: patch.timeoutSeconds,
      updatedById,
      updatedAt: now,
    })
    .where(eq(schema.mailSettings.id, existing.id))
    .returning();
  if (!saved) throw new MailError(500, "mail_settings_missing", "Mail settings could not be saved.");
  return toMailPublic(saved, hasMailCredentialsKey());
}

export async function readMailRuntime(db: Db): Promise<MailRuntime> {
  const row = await ensureMailSettings(db);
  let password: string | null = null;
  let apiToken: string | null = null;
  try {
    if (row.passwordEnc) password = decryptMailSecret(row.passwordEnc);
    if (row.apiTokenEnc) apiToken = decryptMailSecret(row.apiTokenEnc);
  } catch {
    throw new MailError(
      500,
      "mail_key_missing",
      "Saved mail secrets could not be read. Check EMAIL_CREDENTIALS_KEY.",
    );
  }
  const encryption = MAIL_ENCRYPTIONS.includes(row.encryption as MailEncryption)
    ? (row.encryption as MailEncryption)
    : "starttls";
  return {
    enabled: row.enabled,
    host: row.host,
    port: row.port,
    encryption,
    username: row.username,
    password,
    apiToken,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    replyTo: row.replyTo,
    timeoutSeconds: row.timeoutSeconds,
  };
}

/** Login may offer email signup only when the flag is on and outbound mail can send. */
export function isEmailSignupOpen(input: {
  enabled: boolean;
  selfSignupEnabled: boolean;
  host: string;
  fromAddress: string;
}): boolean {
  return (
    input.selfSignupEnabled &&
    input.enabled &&
    Boolean(input.host.trim()) &&
    Boolean(input.fromAddress.trim())
  );
}

export async function isEmailSignupAvailable(db: Db): Promise<boolean> {
  const row = await ensureMailSettings(db);
  return isEmailSignupOpen(row);
}

export function assertSendable(runtime: MailRuntime, kind: "test" | "outbound"): void {
  if (kind === "outbound" && !runtime.enabled) {
    throw new MailError(400, "mail_disabled", "Outbound email is turned off.");
  }
  if (!runtime.host || !runtime.fromAddress) {
    throw new MailError(400, "mail_not_configured", "Set a host and From address before sending.");
  }
}
