ALTER TABLE "task_activity" ADD COLUMN "created_by_id" integer;--> statement-breakpoint
ALTER TABLE "task_activity" ADD COLUMN "source" text DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;