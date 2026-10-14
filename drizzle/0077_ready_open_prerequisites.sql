WITH blocked AS (
  UPDATE tasks AS t
  SET
    state = 'blocked',
    updated_at = now()
  WHERE t.state = 'ready'
    AND (t.state_manual OR t.rollup_total IS NULL)
    AND EXISTS (
      SELECT 1
      FROM task_dependencies AS d
      INNER JOIN tasks AS dep ON dep.id = d.depends_on_task_id
      WHERE d.task_id = t.id
        AND dep.state NOT IN ('complete', 'canceled', 'deleted', 'pending')
    )
  RETURNING t.id
)
INSERT INTO task_activity (
  task_id,
  entity_type,
  entity_id,
  kind,
  field,
  old_value,
  new_value,
  source
)
SELECT
  blocked.id,
  'task',
  blocked.id,
  'change',
  'state',
  'Ready',
  'Blocked',
  'api'
FROM blocked;
