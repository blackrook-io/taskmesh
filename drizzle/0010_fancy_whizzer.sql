ALTER TABLE "tasks" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "number" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "state" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "priority" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "due_date" date;--> statement-breakpoint
UPDATE "tasks" SET "number" = "id" WHERE "number" IS NULL;--> statement-breakpoint
UPDATE "tasks" SET "due_date" = ("due_at" AT TIME ZONE 'UTC')::date WHERE "due_date" IS NULL AND "due_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_number_unique" UNIQUE("number");
