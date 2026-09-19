CREATE TABLE "mfa_login_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lock_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_totp_secret_enc" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_grace_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mfa_login_challenges" ADD CONSTRAINT "mfa_login_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mfa_login_challenges_user_id_idx" ON "mfa_login_challenges" USING btree ("user_id");--> statement-breakpoint
INSERT INTO "system_properties" ("key", "value") VALUES ('mfa_enforcement', '"none"'::jsonb) ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "system_properties" ("key", "value") VALUES ('mfa_grace_days', '7'::jsonb) ON CONFLICT ("key") DO NOTHING;