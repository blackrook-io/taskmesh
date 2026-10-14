CREATE TABLE "ai_tag_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"tag_id" integer,
	"proposed_name" text,
	"confidence" real NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"audit_id" integer,
	"journal_id" integer,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_tag_suggestions_status_chk" CHECK ("ai_tag_suggestions"."status" in ('pending', 'applied', 'accepted', 'dismissed')),
	CONSTRAINT "ai_tag_suggestions_confidence_chk" CHECK ("ai_tag_suggestions"."confidence" >= 0 and "ai_tag_suggestions"."confidence" <= 1),
	CONSTRAINT "ai_tag_suggestions_target_chk" CHECK ("ai_tag_suggestions"."tag_id" is not null or "ai_tag_suggestions"."proposed_name" is not null),
	CONSTRAINT "ai_tag_suggestions_entity_type_chk" CHECK ("ai_tag_suggestions"."entity_type" in ('idea', 'project', 'task', 'todo', 'document')),
	CONSTRAINT "ai_tag_suggestions_name_chk" CHECK ("ai_tag_suggestions"."proposed_name" is null or char_length("ai_tag_suggestions"."proposed_name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "ai_tag_suggestions" ADD CONSTRAINT "ai_tag_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tag_suggestions" ADD CONSTRAINT "ai_tag_suggestions_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tag_suggestions" ADD CONSTRAINT "ai_tag_suggestions_audit_id_ai_audit_log_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."ai_audit_log"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tag_suggestions" ADD CONSTRAINT "ai_tag_suggestions_journal_id_ai_undo_journal_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."ai_undo_journal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_tag_suggestions_entity_idx" ON "ai_tag_suggestions" USING btree ("user_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "ai_tag_suggestions_journal_idx" ON "ai_tag_suggestions" USING btree ("journal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_tag_suggestions_pending_tag_uidx" ON "ai_tag_suggestions" USING btree ("user_id","entity_type","entity_id","tag_id") WHERE "ai_tag_suggestions"."status" = 'pending' and "ai_tag_suggestions"."tag_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_tag_suggestions_pending_name_uidx" ON "ai_tag_suggestions" USING btree ("user_id","entity_type","entity_id","proposed_name") WHERE "ai_tag_suggestions"."status" = 'pending' and "ai_tag_suggestions"."proposed_name" is not null;