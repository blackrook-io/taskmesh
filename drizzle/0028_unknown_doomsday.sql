CREATE TABLE "todos" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"state" text DEFAULT 'new' NOT NULL,
	"priority" text DEFAULT 'none' NOT NULL,
	"due_date" date,
	"action_by" timestamp with time zone,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_idea_id" integer,
	"created_by_id" integer NOT NULL,
	"updated_by_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "todos_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_source_idea_id_ideas_id_fk" FOREIGN KEY ("source_idea_id") REFERENCES "public"."ideas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;