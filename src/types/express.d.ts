import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface Locals {
    /** Prefer this message in api_request_logs over the default. */
    logMessage?: string;
    logUserId?: number | null;
    logApiKeyId?: number | null;
    logAdminKey?: boolean;
    /** When true, apiRequestLogger skips inserting a row (caller already audited). */
    skipRequestLog?: boolean;
  }
}

export {};
