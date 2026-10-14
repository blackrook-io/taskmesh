CREATE TABLE "digest_item_hides" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"section" text NOT NULL,
	"kind" text NOT NULL,
	"period_key" text,
	"until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_item_hides_kind_chk" CHECK ("digest_item_hides"."kind" in ('snooze', 'dismiss')),
	CONSTRAINT "digest_item_hides_section_chk" CHECK ("digest_item_hides"."section" in ('overdue', 'at_risk', 'stale', 'blocked', 'changed', 'suggestions', 'duplicates', 'assigned_out')),
	CONSTRAINT "digest_item_hides_shape_chk" CHECK (("digest_item_hides"."kind" = 'snooze' and "digest_item_hides"."until" is not null) or ("digest_item_hides"."kind" = 'dismiss' and "digest_item_hides"."period_key" is not null))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "digest_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "digest_item_hides" ADD CONSTRAINT "digest_item_hides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "digest_item_hides_user_item_uidx" ON "digest_item_hides" USING btree ("user_id","entity_type","entity_id","section");