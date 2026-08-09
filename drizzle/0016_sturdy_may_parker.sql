CREATE TABLE "task_dependencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"depends_on_task_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_pair_uidx" UNIQUE("task_id","depends_on_task_id"),
	CONSTRAINT "task_dependencies_no_self" CHECK ("task_id" <> "depends_on_task_id")
);
--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;