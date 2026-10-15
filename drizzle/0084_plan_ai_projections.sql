CREATE TABLE "plan_ai_projections" (
	"plan_id" integer PRIMARY KEY NOT NULL,
	"input_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"audit_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_ai_projections" ADD CONSTRAINT "plan_ai_projections_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_ai_projections" ADD CONSTRAINT "plan_ai_projections_audit_id_ai_audit_log_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."ai_audit_log"("id") ON DELETE set null ON UPDATE no action;