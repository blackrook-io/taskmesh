CREATE TABLE "mesh_layouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"root_type" text NOT NULL,
	"root_id" integer NOT NULL,
	"view" text NOT NULL,
	"positions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"viewport" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mesh_layouts_owner_root_view_uidx" UNIQUE("owner_id","root_type","root_id","view"),
	CONSTRAINT "mesh_layouts_root_type_chk" CHECK ("mesh_layouts"."root_type" in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board', 'tag')),
	CONSTRAINT "mesh_layouts_view_chk" CHECK ("mesh_layouts"."view" in ('focus', 'plan'))
);
--> statement-breakpoint
ALTER TABLE "mesh_layouts" ADD CONSTRAINT "mesh_layouts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mesh_layouts_owner_id_idx" ON "mesh_layouts" USING btree ("owner_id");