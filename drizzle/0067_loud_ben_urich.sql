ALTER TABLE "ai_audit_log" DROP CONSTRAINT "ai_audit_log_action_chk";--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD COLUMN "key_source" text;--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD COLUMN "cost_microusd" integer;--> statement-breakpoint
CREATE INDEX "ai_audit_log_usage_user_idx" ON "ai_audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD CONSTRAINT "ai_audit_log_key_source_chk" CHECK ("ai_audit_log"."key_source" is null or "ai_audit_log"."key_source" in ('user', 'instance', 'local'));--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD CONSTRAINT "ai_audit_log_cost_microusd_chk" CHECK ("ai_audit_log"."cost_microusd" is null or "ai_audit_log"."cost_microusd" >= 0);--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD CONSTRAINT "ai_audit_log_action_chk" CHECK ("ai_audit_log"."action" in ('read', 'propose_create', 'propose_update', 'link', 'tag', 'comment', 'apply', 'propose_delete', 'web_fetch', 'bulk', 'respond', 'key_mode', 'route', 'undo', 'usage'));--> statement-breakpoint
INSERT INTO "system_properties" ("key", "value") VALUES ('ai_budgets', '{"tokensPerUserPerDay":null,"instanceSpendUsdPerDay":null,"toolCallsPerRun":null,"writesPerRun":null}'::jsonb) ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "system_properties" ("key", "value") VALUES ('ai_instance_usd_per_million_tokens', '1'::jsonb) ON CONFLICT ("key") DO NOTHING;