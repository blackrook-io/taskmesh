ALTER TABLE "tags" DROP CONSTRAINT "tags_name_unique";--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "image_boards" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "task_description_templates" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "todo_lists" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "owner_id" integer;--> statement-breakpoint
UPDATE "ideas" SET "owner_id" = 1 WHERE "owner_id" IS NULL;--> statement-breakpoint
UPDATE "image_boards" SET "owner_id" = 1 WHERE "owner_id" IS NULL;--> statement-breakpoint
UPDATE "projects" SET "owner_id" = 1 WHERE "owner_id" IS NULL;--> statement-breakpoint
UPDATE "tags" SET "owner_id" = 1 WHERE "owner_id" IS NULL;--> statement-breakpoint
UPDATE "task_description_templates" SET "owner_id" = COALESCE("created_by_id", 1) WHERE "owner_id" IS NULL;--> statement-breakpoint
UPDATE "tasks" SET "owner_id" = 1 WHERE "owner_id" IS NULL;--> statement-breakpoint
UPDATE "todo_lists" SET "owner_id" = 1 WHERE "owner_id" IS NULL;--> statement-breakpoint
UPDATE "todos" SET "owner_id" = 1 WHERE "owner_id" IS NULL;--> statement-breakpoint
UPDATE "uploads" SET "owner_id" = 1 WHERE "owner_id" IS NULL;--> statement-breakpoint
ALTER TABLE "ideas" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "image_boards" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task_description_templates" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "todo_lists" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "todos" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_boards" ADD CONSTRAINT "image_boards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_description_templates" ADD CONSTRAINT "task_description_templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_lists" ADD CONSTRAINT "todo_lists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_owner_id_name_uidx" UNIQUE("owner_id","name");
