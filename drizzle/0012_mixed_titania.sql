CREATE TABLE "task_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"kind" text NOT NULL,
	"body" text,
	"edited_at" timestamp with time zone,
	"field" text,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" RENAME COLUMN "notes" TO "description";--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;