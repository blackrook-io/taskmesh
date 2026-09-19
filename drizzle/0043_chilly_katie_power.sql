CREATE TABLE "mfa_trusted_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_trusted_devices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "mfa_trusted_devices" ADD CONSTRAINT "mfa_trusted_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mfa_trusted_devices_user_id_idx" ON "mfa_trusted_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mfa_trusted_devices_expires_at_idx" ON "mfa_trusted_devices" USING btree ("expires_at");--> statement-breakpoint
INSERT INTO "system_properties" ("key", "value") VALUES ('mfa_trusted_device_days', '15'::jsonb) ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "system_properties" ("key", "value") VALUES ('mfa_trusted_device_max', '5'::jsonb) ON CONFLICT ("key") DO NOTHING;
