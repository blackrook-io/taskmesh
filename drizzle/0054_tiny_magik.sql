CREATE TABLE "user_task_list_state" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"collapsed_group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"collapsed_ungrouped_project_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"collapsed_parent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_task_list_state" ADD CONSTRAINT "user_task_list_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;