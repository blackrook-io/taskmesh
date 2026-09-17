ALTER TABLE "ideas" ADD COLUMN "assignee_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "assignee_id" integer;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "assignee_id" integer;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ideas_assignee_id_idx" ON "ideas" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_id_idx" ON "tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "todos_assignee_id_idx" ON "todos" USING btree ("assignee_id");--> statement-breakpoint
-- Solo-owner projects: stamp Owner as assignee on existing null rows (T0117)
UPDATE tasks t
SET assignee_id = p.owner_id
FROM projects p
WHERE t.project_id = p.id
  AND t.assignee_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM project_managers pm WHERE pm.project_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM project_members mb WHERE mb.project_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM project_viewers pv WHERE pv.project_id = p.id);--> statement-breakpoint
UPDATE todos d
SET assignee_id = p.owner_id
FROM projects p
WHERE d.project_id = p.id
  AND d.assignee_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM project_managers pm WHERE pm.project_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM project_members mb WHERE mb.project_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM project_viewers pv WHERE pv.project_id = p.id);
