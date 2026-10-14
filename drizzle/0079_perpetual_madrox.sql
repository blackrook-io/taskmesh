CREATE TABLE "attention_digests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"period_key" text NOT NULL,
	"frequency" text NOT NULL,
	"time_zone" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sections" jsonb NOT NULL,
	"counts" jsonb NOT NULL,
	"enabled" jsonb NOT NULL,
	"summary" text,
	"summary_source" text,
	"excluded_projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "attention_digests_frequency_chk" CHECK ("attention_digests"."frequency" in ('daily', 'weekly')),
	CONSTRAINT "attention_digests_summary_source_chk" CHECK ("attention_digests"."summary_source" is null or "attention_digests"."summary_source" = 'model')
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "digest_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "attention_digests" ADD CONSTRAINT "attention_digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attention_digests_user_period_uidx" ON "attention_digests" USING btree ("user_id","period_key");--> statement-breakpoint
CREATE INDEX "attention_digests_user_generated_idx" ON "attention_digests" USING btree ("user_id","generated_at");