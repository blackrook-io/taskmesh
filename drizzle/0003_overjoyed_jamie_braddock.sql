CREATE TABLE "todo_list_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "todo_list_items_list_entity_uidx" UNIQUE("list_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "todo_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"title" text NOT NULL,
	"kind" text DEFAULT 'list' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "todo_list_items" ADD CONSTRAINT "todo_list_items_list_id_todo_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."todo_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_lists" ADD CONSTRAINT "todo_lists_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;