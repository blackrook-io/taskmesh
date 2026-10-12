-- T0294: Tags membership in saved Task Group filters uses contains / does not contain.
-- `is` and `is_not` matched the same way; rewrite them so stored filters stay valid.
UPDATE task_groups AS g
SET
  filter = jsonb_set(
    g.filter,
    '{clauses}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN c->>'field' = 'tags' AND c->>'operator' = 'is'
            THEN jsonb_set(c, '{operator}', to_jsonb('contains'::text))
          WHEN c->>'field' = 'tags' AND c->>'operator' = 'is_not'
            THEN jsonb_set(c, '{operator}', to_jsonb('does_not_contain'::text))
          ELSE c
        END
      )
      FROM jsonb_array_elements(g.filter->'clauses') AS c
    )
  ),
  updated_at = now()
WHERE g.filter IS NOT NULL
  AND jsonb_typeof(g.filter->'clauses') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(g.filter->'clauses') AS c
    WHERE c->>'field' = 'tags'
      AND c->>'operator' IN ('is', 'is_not')
  );
