ALTER TABLE "plans" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "workday_hours" numeric(4, 2) DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_start_not_after_target" CHECK ("plans"."start_date" is null or "plans"."target_date" is null or "plans"."start_date" <= "plans"."target_date");--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_workday_hours_quarter" CHECK ("plans"."workday_hours" >= 0.25 AND "plans"."workday_hours" <= 24 AND "plans"."workday_hours" * 4 = trunc("plans"."workday_hours" * 4));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_start_not_after_due" CHECK ("tasks"."start_date" is null or "tasks"."due_date" is null or "tasks"."start_date" <= "tasks"."due_date");--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_start_not_after_due" CHECK ("todos"."start_date" is null or "todos"."due_date" is null or "todos"."start_date" <= "todos"."due_date");--> statement-breakpoint
INSERT INTO "entity_fields" ("entity_type", "field_key", "label", "displayable", "default_visible", "default_sort_order", "sortable", "scope") VALUES
  ('task', 'startDate', 'Start date', true, true, 55, true, NULL),
  ('todo_list', 'startDate', 'Start date', true, true, 55, true, NULL)
ON CONFLICT ("entity_type", "field_key") DO NOTHING;