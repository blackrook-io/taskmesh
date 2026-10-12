CREATE TABLE "ai_undo_journal" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"audit_id" integer,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" integer,
	"summary" text NOT NULL,
	"inverse" jsonb NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"status" text DEFAULT 'applied' NOT NULL,
	CONSTRAINT "ai_undo_journal_action_chk" CHECK ("ai_undo_journal"."action" in ('tag', 'link', 'comment')),
	CONSTRAINT "ai_undo_journal_status_chk" CHECK ("ai_undo_journal"."status" in ('applied', 'undone', 'skipped')),
	CONSTRAINT "ai_undo_journal_summary_chk" CHECK (char_length("ai_undo_journal"."summary") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "ai_audit_log" DROP CONSTRAINT "ai_audit_log_action_chk";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_tier1_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_undo_journal" ADD CONSTRAINT "ai_undo_journal_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_undo_journal" ADD CONSTRAINT "ai_undo_journal_audit_id_ai_audit_log_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."ai_audit_log"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_undo_journal_user_applied_idx" ON "ai_undo_journal" USING btree ("user_id","applied_at");--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD CONSTRAINT "ai_audit_log_action_chk" CHECK ("ai_audit_log"."action" in ('read', 'propose_create', 'propose_update', 'link', 'tag', 'comment', 'apply', 'propose_delete', 'web_fetch', 'bulk', 'respond', 'key_mode', 'route', 'undo'));--> statement-breakpoint
INSERT INTO "system_properties" ("key", "value") VALUES ('ai_undo_window_days', '7'::jsonb) ON CONFLICT ("key") DO NOTHING;