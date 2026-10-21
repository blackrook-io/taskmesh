/** pg-boss queue for outbound mail. Later features call `enqueueOutboundMail`. */
export const JOB_EMAIL_SEND = "email-send";

export const MAIL_RESULTS = ["queued", "sent", "failed", "retry", "verified"] as const;
export type MailResult = (typeof MAIL_RESULTS)[number];

export const MAIL_KINDS = ["outbound", "test", "connection"] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

export const MAIL_ENCRYPTIONS = ["none", "starttls", "tls"] as const;
export type MailEncryption = (typeof MAIL_ENCRYPTIONS)[number];
