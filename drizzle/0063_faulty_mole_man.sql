CREATE TABLE "user_ai_route_prefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"feature" text NOT NULL,
	"plugin_id" text NOT NULL,
	"model" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_ai_route_prefs_user_feature_uidx" UNIQUE("user_id","feature"),
	CONSTRAINT "user_ai_route_prefs_feature_chk" CHECK ("user_ai_route_prefs"."feature" ~ '^[a-z0-9_]+$'),
	CONSTRAINT "user_ai_route_prefs_plugin_chk" CHECK ("user_ai_route_prefs"."plugin_id" ~ '^[a-z0-9-]+$'),
	CONSTRAINT "user_ai_route_prefs_model_chk" CHECK (char_length("user_ai_route_prefs"."model") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "ai_audit_log" DROP CONSTRAINT "ai_audit_log_action_chk";--> statement-breakpoint
ALTER TABLE "user_ai_route_prefs" ADD CONSTRAINT "user_ai_route_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD CONSTRAINT "ai_audit_log_action_chk" CHECK ("ai_audit_log"."action" in ('read', 'propose_create', 'propose_update', 'link', 'tag', 'comment', 'apply', 'propose_delete', 'web_fetch', 'bulk', 'respond', 'key_mode', 'route'));