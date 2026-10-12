CREATE TABLE "ai_output_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"audit_id" integer NOT NULL,
	"user_id" integer,
	"kind" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_output_feedback_kind_chk" CHECK ("ai_output_feedback"."kind" in ('thumb_up', 'thumb_down', 'accept', 'dismiss', 'undo')),
	CONSTRAINT "ai_output_feedback_note_chk" CHECK ("ai_output_feedback"."note" is null or char_length("ai_output_feedback"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "ai_output_feedback" ADD CONSTRAINT "ai_output_feedback_audit_id_ai_audit_log_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."ai_audit_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_output_feedback" ADD CONSTRAINT "ai_output_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_output_feedback_audit_id_idx" ON "ai_output_feedback" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "ai_output_feedback_created_at_idx" ON "ai_output_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_output_feedback_thumb_uidx" ON "ai_output_feedback" USING btree ("audit_id","user_id") WHERE "ai_output_feedback"."kind" in ('thumb_up', 'thumb_down');--> statement-breakpoint
CREATE UNIQUE INDEX "ai_output_feedback_outcome_uidx" ON "ai_output_feedback" USING btree ("audit_id","kind") WHERE "ai_output_feedback"."kind" in ('accept', 'dismiss', 'undo');