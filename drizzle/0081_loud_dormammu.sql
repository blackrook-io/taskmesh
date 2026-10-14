CREATE TABLE "ai_link_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"src_type" text NOT NULL,
	"src_id" integer NOT NULL,
	"dst_type" text NOT NULL,
	"dst_id" integer NOT NULL,
	"score" real NOT NULL,
	"reason" text NOT NULL,
	"signal" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"audit_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_link_suggestions_status_chk" CHECK ("ai_link_suggestions"."status" in ('pending', 'accepted', 'dismissed', 'rejected')),
	CONSTRAINT "ai_link_suggestions_score_chk" CHECK ("ai_link_suggestions"."score" >= 0 and "ai_link_suggestions"."score" <= 1),
	CONSTRAINT "ai_link_suggestions_reason_chk" CHECK (char_length("ai_link_suggestions"."reason") between 1 and 160),
	CONSTRAINT "ai_link_suggestions_signal_chk" CHECK ("ai_link_suggestions"."signal" in ('shared_tags', 'mention', 'same_list', 'same_board', 'similar_text')),
	CONSTRAINT "ai_link_suggestions_type_chk" CHECK ("ai_link_suggestions"."src_type" in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board') and "ai_link_suggestions"."dst_type" in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board')),
	CONSTRAINT "ai_link_suggestions_not_self" CHECK (not ("ai_link_suggestions"."src_type" = "ai_link_suggestions"."dst_type" and "ai_link_suggestions"."src_id" = "ai_link_suggestions"."dst_id"))
);
--> statement-breakpoint
ALTER TABLE "ai_link_suggestions" ADD CONSTRAINT "ai_link_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_link_suggestions" ADD CONSTRAINT "ai_link_suggestions_audit_id_ai_audit_log_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."ai_audit_log"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_link_suggestions_pair_uidx" ON "ai_link_suggestions" USING btree ("user_id","src_type","src_id","dst_type","dst_id");--> statement-breakpoint
CREATE INDEX "ai_link_suggestions_src_idx" ON "ai_link_suggestions" USING btree ("user_id","src_type","src_id");--> statement-breakpoint
CREATE INDEX "ai_link_suggestions_dst_idx" ON "ai_link_suggestions" USING btree ("user_id","dst_type","dst_id");