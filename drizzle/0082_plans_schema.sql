CREATE TABLE "plan_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"phase_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_items_plan_entity_uidx" UNIQUE("plan_id","entity_type","entity_id"),
	CONSTRAINT "plan_items_entity_type_chk" CHECK ("plan_items"."entity_type" in ('task', 'todo'))
);
--> statement-breakpoint
CREATE TABLE "plan_phases" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"project_id" integer,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"target_date" date,
	"capacity_hours_per_week" numeric(5, 2),
	"revision" integer DEFAULT 0 NOT NULL,
	"owner_id" integer NOT NULL,
	"created_by_id" integer NOT NULL,
	"updated_by_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_number_unique" UNIQUE("number"),
	CONSTRAINT "plans_status_chk" CHECK ("plans"."status" in ('draft', 'active', 'complete', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "ai_link_suggestions" DROP CONSTRAINT "ai_link_suggestions_type_chk";--> statement-breakpoint
ALTER TABLE "entity_links" DROP CONSTRAINT "entity_links_src_type_chk";--> statement-breakpoint
ALTER TABLE "entity_links" DROP CONSTRAINT "entity_links_dst_type_chk";--> statement-breakpoint
ALTER TABLE "knowledge_chunks" DROP CONSTRAINT "knowledge_chunks_entity_type_chk";--> statement-breakpoint
ALTER TABLE "mesh_layouts" DROP CONSTRAINT "mesh_layouts_root_type_chk";--> statement-breakpoint
ALTER TABLE "task_activity" DROP CONSTRAINT "task_activity_entity_type_chk";--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_phase_id_plan_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."plan_phases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_phases" ADD CONSTRAINT "plan_phases_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_items_order_idx" ON "plan_items" USING btree ("plan_id","phase_id","sort_order");--> statement-breakpoint
CREATE INDEX "plan_items_entity_idx" ON "plan_items" USING btree ("entity_type","entity_id");--> statement-breakpoint
ALTER TABLE "ai_link_suggestions" ADD CONSTRAINT "ai_link_suggestions_type_chk" CHECK ("ai_link_suggestions"."src_type" in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board', 'plan') and "ai_link_suggestions"."dst_type" in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board', 'plan'));--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_src_type_chk" CHECK ("entity_links"."src_type" in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board', 'plan'));--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_dst_type_chk" CHECK ("entity_links"."dst_type" in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board', 'plan'));--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_entity_type_chk" CHECK ("knowledge_chunks"."entity_type" in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board', 'plan'));--> statement-breakpoint
ALTER TABLE "mesh_layouts" ADD CONSTRAINT "mesh_layouts_root_type_chk" CHECK ("mesh_layouts"."root_type" in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board', 'plan', 'tag'));--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_entity_type_chk" CHECK ("task_activity"."entity_type" in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board', 'plan'));--> statement-breakpoint
INSERT INTO "project_modules" ("project_id", "module_key", "enabled", "sort_order")
SELECT "id", 'plans', false, 7 FROM "projects"
ON CONFLICT ("project_id", "module_key") DO NOTHING;--> statement-breakpoint
CREATE OR REPLACE FUNCTION purge_plan_items() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM plan_items
  WHERE entity_type = TG_ARGV[0] AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER todos_purge_plan_items AFTER DELETE ON todos FOR EACH ROW EXECUTE FUNCTION purge_plan_items('todo');--> statement-breakpoint
CREATE TRIGGER tasks_purge_plan_items AFTER DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION purge_plan_items('task');--> statement-breakpoint
CREATE TRIGGER plans_purge_entity_activity AFTER DELETE ON plans FOR EACH ROW EXECUTE FUNCTION purge_entity_activity('plan');--> statement-breakpoint
CREATE TRIGGER plans_purge_entity_links AFTER DELETE ON plans FOR EACH ROW EXECUTE FUNCTION purge_entity_links('plan');