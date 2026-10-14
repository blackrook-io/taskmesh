ALTER TABLE "tasks" ADD COLUMN "estimate_hours" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "estimate_hours" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_estimate_hours_quarter" CHECK ("tasks"."estimate_hours" >= 0 AND "tasks"."estimate_hours" * 4 = trunc("tasks"."estimate_hours" * 4));--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_estimate_hours_quarter" CHECK ("todos"."estimate_hours" >= 0 AND "todos"."estimate_hours" * 4 = trunc("todos"."estimate_hours" * 4));--> statement-breakpoint
INSERT INTO "entity_fields" ("entity_type", "field_key", "label", "displayable", "default_visible", "default_sort_order", "sortable", "scope") VALUES
  ('task', 'estimateHours', 'Hours', true, true, 65, true, NULL),
  ('todo_list', 'estimateHours', 'Hours', true, true, 65, true, NULL)
ON CONFLICT ("entity_type", "field_key") DO NOTHING;