CREATE TABLE "wiki_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"parent_id" integer,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"title" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_nodes_project_entity_uidx" UNIQUE("project_id","entity_type","entity_id")
);
--> statement-breakpoint
ALTER TABLE "wiki_nodes" ADD CONSTRAINT "wiki_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_nodes" ADD CONSTRAINT "wiki_nodes_parent_id_wiki_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."wiki_nodes"("id") ON DELETE cascade ON UPDATE no action;