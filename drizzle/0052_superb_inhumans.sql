CREATE TABLE "entity_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"src_type" text NOT NULL,
	"src_id" integer NOT NULL,
	"dst_type" text NOT NULL,
	"dst_id" integer NOT NULL,
	"relation" text DEFAULT 'relates_to' NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"created_by_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_links_pair_uidx" UNIQUE("src_type","src_id","dst_type","dst_id","relation","origin"),
	CONSTRAINT "entity_links_src_type_chk" CHECK ("entity_links"."src_type" in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board')),
	CONSTRAINT "entity_links_dst_type_chk" CHECK ("entity_links"."dst_type" in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board')),
	CONSTRAINT "entity_links_relation_chk" CHECK ("entity_links"."relation" in ('relates_to', 'references', 'supports', 'part_of')),
	CONSTRAINT "entity_links_origin_chk" CHECK ("entity_links"."origin" in ('manual', 'mention')),
	CONSTRAINT "entity_links_not_self" CHECK (not ("entity_links"."src_type" = "entity_links"."dst_type" and "entity_links"."src_id" = "entity_links"."dst_id"))
);
--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_links_src_idx" ON "entity_links" USING btree ("src_type","src_id");--> statement-breakpoint
CREATE INDEX "entity_links_dst_idx" ON "entity_links" USING btree ("dst_type","dst_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION purge_entity_links() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM entity_links
  WHERE (src_type = TG_ARGV[0] AND src_id = OLD.id)
     OR (dst_type = TG_ARGV[0] AND dst_id = OLD.id);
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER ideas_purge_entity_links AFTER DELETE ON ideas FOR EACH ROW EXECUTE FUNCTION purge_entity_links('idea');--> statement-breakpoint
CREATE TRIGGER projects_purge_entity_links AFTER DELETE ON projects FOR EACH ROW EXECUTE FUNCTION purge_entity_links('project');--> statement-breakpoint
CREATE TRIGGER tasks_purge_entity_links AFTER DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION purge_entity_links('task');--> statement-breakpoint
CREATE TRIGGER todos_purge_entity_links AFTER DELETE ON todos FOR EACH ROW EXECUTE FUNCTION purge_entity_links('todo');--> statement-breakpoint
CREATE TRIGGER project_documents_purge_entity_links AFTER DELETE ON project_documents FOR EACH ROW EXECUTE FUNCTION purge_entity_links('document');--> statement-breakpoint
CREATE TRIGGER todo_lists_purge_entity_links AFTER DELETE ON todo_lists FOR EACH ROW EXECUTE FUNCTION purge_entity_links('todo_list');--> statement-breakpoint
CREATE TRIGGER boards_purge_entity_links AFTER DELETE ON boards FOR EACH ROW EXECUTE FUNCTION purge_entity_links('board');--> statement-breakpoint
CREATE TRIGGER canvases_purge_entity_links AFTER DELETE ON canvases FOR EACH ROW EXECUTE FUNCTION purge_entity_links('canvas');--> statement-breakpoint
CREATE TRIGGER wiki_nodes_purge_entity_links AFTER DELETE ON wiki_nodes FOR EACH ROW EXECUTE FUNCTION purge_entity_links('wiki_node');--> statement-breakpoint
CREATE TRIGGER image_boards_purge_entity_links AFTER DELETE ON image_boards FOR EACH ROW EXECUTE FUNCTION purge_entity_links('image_board');