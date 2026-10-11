ALTER TABLE "task_activity" ADD COLUMN "entity_type" text;--> statement-breakpoint
ALTER TABLE "task_activity" ADD COLUMN "entity_id" integer;--> statement-breakpoint
UPDATE "task_activity" SET "entity_type" = 'task', "entity_id" = "task_id";--> statement-breakpoint
ALTER TABLE "task_activity" ALTER COLUMN "entity_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task_activity" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task_activity" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "task_activity_entity_idx" ON "task_activity" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_entity_type_chk" CHECK ("task_activity"."entity_type" in ('idea', 'project', 'task', 'todo', 'document', 'todo_list', 'board', 'canvas', 'wiki_node', 'image_board'));--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_task_link_chk" CHECK (("task_activity"."entity_type" = 'task' and "task_activity"."task_id" = "task_activity"."entity_id") or ("task_activity"."entity_type" <> 'task' and "task_activity"."task_id" is null));--> statement-breakpoint
CREATE OR REPLACE FUNCTION purge_entity_activity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM task_activity
  WHERE entity_type = TG_ARGV[0] AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER todos_purge_entity_activity AFTER DELETE ON todos FOR EACH ROW EXECUTE FUNCTION purge_entity_activity('todo');--> statement-breakpoint
CREATE TRIGGER projects_purge_entity_activity AFTER DELETE ON projects FOR EACH ROW EXECUTE FUNCTION purge_entity_activity('project');--> statement-breakpoint
CREATE TRIGGER project_documents_purge_entity_activity AFTER DELETE ON project_documents FOR EACH ROW EXECUTE FUNCTION purge_entity_activity('document');
