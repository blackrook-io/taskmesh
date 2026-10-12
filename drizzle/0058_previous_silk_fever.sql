CREATE TABLE "ai_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"feature" text NOT NULL,
	"provider" text,
	"model" text,
	"tool" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" integer,
	"project_id" integer,
	"decision" text NOT NULL,
	"reason" text,
	"tier" integer NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_audit_log_decision_chk" CHECK ("ai_audit_log"."decision" in ('allow', 'deny')),
	CONSTRAINT "ai_audit_log_action_chk" CHECK ("ai_audit_log"."action" in ('read', 'propose_create', 'propose_update', 'link', 'tag', 'comment', 'apply', 'propose_delete', 'web_fetch', 'bulk', 'respond'))
);
--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD CONSTRAINT "ai_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD CONSTRAINT "ai_audit_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_audit_log_created_at_idx" ON "ai_audit_log" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_source_chk" CHECK ("task_activity"."source" in ('ui', 'api', 'ai'));