CREATE TABLE "mail_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" text NOT NULL,
	"to_address" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"warning" text,
	"error" text,
	"job_id" text,
	"kind" text DEFAULT 'outbound' NOT NULL,
	CONSTRAINT "mail_log_result_chk" CHECK ("mail_log"."result" in ('queued', 'sent', 'failed', 'retry', 'verified')),
	CONSTRAINT "mail_log_kind_chk" CHECK ("mail_log"."kind" in ('outbound', 'test', 'connection'))
);
--> statement-breakpoint
CREATE TABLE "mail_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"host" text DEFAULT '' NOT NULL,
	"port" integer DEFAULT 587 NOT NULL,
	"encryption" text DEFAULT 'starttls' NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"password_enc" text,
	"password_hint" text,
	"api_token_enc" text,
	"api_token_hint" text,
	"from_address" text DEFAULT '' NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"reply_to" text DEFAULT '' NOT NULL,
	"timeout_seconds" integer DEFAULT 30 NOT NULL,
	"updated_by_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_settings_singleton_chk" CHECK ("mail_settings"."id" = 1),
	CONSTRAINT "mail_settings_encryption_chk" CHECK ("mail_settings"."encryption" in ('none', 'starttls', 'tls')),
	CONSTRAINT "mail_settings_port_chk" CHECK ("mail_settings"."port" between 1 and 65535),
	CONSTRAINT "mail_settings_timeout_chk" CHECK ("mail_settings"."timeout_seconds" between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_log_created_at_idx" ON "mail_log" USING btree ("created_at");--> statement-breakpoint
INSERT INTO "mail_settings" ("id") VALUES (1);