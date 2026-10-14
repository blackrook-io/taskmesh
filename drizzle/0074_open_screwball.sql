ALTER TABLE "tasks" ADD COLUMN "state_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "rollup_done" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "rollup_total" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_rollup_pair" CHECK (("tasks"."rollup_done" is null and "tasks"."rollup_total" is null) or ("tasks"."rollup_done" >= 0 and "tasks"."rollup_total" > 0 and "tasks"."rollup_done" <= "tasks"."rollup_total"));--> statement-breakpoint
WITH RECURSIVE walk AS (
  SELECT id AS root_id, id, parent_id, state
  FROM tasks
  WHERE state <> 'deleted'
  UNION ALL
  SELECT w.root_id, t.id, t.parent_id, t.state
  FROM tasks t
  INNER JOIN walk w ON t.parent_id = w.id
  WHERE t.state <> 'deleted'
),
structural_parents AS (
  SELECT DISTINCT parent_id AS id
  FROM tasks
  WHERE parent_id IS NOT NULL AND state <> 'deleted'
),
leaves AS (
  SELECT w.root_id, w.state
  FROM walk w
  WHERE w.id <> w.root_id
    AND NOT EXISTS (SELECT 1 FROM structural_parents p WHERE p.id = w.id)
    AND w.state <> 'canceled'
),
agg AS (
  SELECT
    root_id,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE state = 'complete')::int AS done,
    BOOL_AND(state = 'complete') AS all_complete,
    BOOL_OR(state = 'blocked') AS any_blocked,
    BOOL_OR(state IN ('in_progress', 'pending', 'complete')) AS any_active,
    BOOL_OR(state = 'on_hold') AS any_hold,
    BOOL_OR(state = 'new') AS any_draft
  FROM leaves
  GROUP BY root_id
)
UPDATE tasks AS t
SET
  rollup_done = agg.done,
  rollup_total = agg.total,
  state = CASE
    WHEN t.state_manual THEN t.state
    WHEN agg.all_complete THEN 'complete'
    WHEN agg.any_blocked THEN 'blocked'
    WHEN agg.any_active THEN 'in_progress'
    WHEN agg.any_hold THEN 'on_hold'
    WHEN agg.any_draft THEN 'new'
    ELSE 'ready'
  END,
  updated_at = now()
FROM agg
WHERE t.id = agg.root_id;