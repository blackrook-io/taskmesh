CREATE TABLE "ai_instance_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"plugin_id" text NOT NULL,
	"secret_enc" text NOT NULL,
	"hint" text NOT NULL,
	"verified_at" timestamp with time zone,
	"updated_by_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_instance_credentials_plugin_id_unique" UNIQUE("plugin_id"),
	CONSTRAINT "ai_instance_credentials_plugin_chk" CHECK ("ai_instance_credentials"."plugin_id" ~ '^[a-z0-9-]+$'),
	CONSTRAINT "ai_instance_credentials_hint_chk" CHECK (char_length("ai_instance_credentials"."hint") between 1 and 4)
);
--> statement-breakpoint
ALTER TABLE "ai_audit_log" DROP CONSTRAINT "ai_audit_log_action_chk";--> statement-breakpoint
ALTER TABLE "ai_instance_credentials" ADD CONSTRAINT "ai_instance_credentials_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD CONSTRAINT "ai_audit_log_action_chk" CHECK ("ai_audit_log"."action" in ('read', 'propose_create', 'propose_update', 'link', 'tag', 'comment', 'apply', 'propose_delete', 'web_fetch', 'bulk', 'respond', 'key_mode'));--> statement-breakpoint
INSERT INTO "system_properties" ("key", "value") VALUES ('ai_key_mode', '"instance_only"'::jsonb) ON CONFLICT ("key") DO NOTHING;