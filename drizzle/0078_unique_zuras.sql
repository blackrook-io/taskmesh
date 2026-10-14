CREATE TABLE "ai_duplicate_pairs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"a_type" text NOT NULL,
	"a_id" integer NOT NULL,
	"b_type" text NOT NULL,
	"b_id" integer NOT NULL,
	"score" real NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_duplicate_pairs_status_chk" CHECK ("ai_duplicate_pairs"."status" in ('pending', 'linked', 'ignored', 'rejected')),
	CONSTRAINT "ai_duplicate_pairs_score_chk" CHECK ("ai_duplicate_pairs"."score" >= 0 and "ai_duplicate_pairs"."score" <= 1),
	CONSTRAINT "ai_duplicate_pairs_reason_chk" CHECK ("ai_duplicate_pairs"."reason" in ('exact_title', 'near_title', 'index', 'model')),
	CONSTRAINT "ai_duplicate_pairs_type_chk" CHECK ("ai_duplicate_pairs"."a_type" in ('task', 'todo') and "ai_duplicate_pairs"."b_type" in ('task', 'todo')),
	CONSTRAINT "ai_duplicate_pairs_order_chk" CHECK ("ai_duplicate_pairs"."a_type" < "ai_duplicate_pairs"."b_type" or ("ai_duplicate_pairs"."a_type" = "ai_duplicate_pairs"."b_type" and "ai_duplicate_pairs"."a_id" < "ai_duplicate_pairs"."b_id"))
);
--> statement-breakpoint
ALTER TABLE "entity_links" DROP CONSTRAINT "entity_links_relation_chk";--> statement-breakpoint
ALTER TABLE "ai_duplicate_pairs" ADD CONSTRAINT "ai_duplicate_pairs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_duplicate_pairs_pair_uidx" ON "ai_duplicate_pairs" USING btree ("user_id","a_type","a_id","b_type","b_id");--> statement-breakpoint
CREATE INDEX "ai_duplicate_pairs_a_idx" ON "ai_duplicate_pairs" USING btree ("user_id","a_type","a_id");--> statement-breakpoint
CREATE INDEX "ai_duplicate_pairs_b_idx" ON "ai_duplicate_pairs" USING btree ("user_id","b_type","b_id");--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_relation_chk" CHECK ("entity_links"."relation" in ('relates_to', 'references', 'supports', 'part_of', 'duplicate_of'));