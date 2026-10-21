ALTER TABLE "mail_settings" ADD COLUMN "self_signup_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_confirm_token_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_confirm_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_confirm_token_hash_uidx" ON "users" USING btree ("email_confirm_token_hash") WHERE "users"."email_confirm_token_hash" is not null;--> statement-breakpoint
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;