-- T0051: column catalog for ToDo list views (list-view key todo_lists → entity type todo_list).
INSERT INTO "entity_fields" ("entity_type", "field_key", "label", "displayable", "default_visible", "default_sort_order", "sortable", "scope") VALUES
  ('todo_list', 'type', 'Type', true, true, 10, true, NULL),
  ('todo_list', 'title', 'Title', true, true, 20, true, NULL),
  ('todo_list', 'tags', 'Tags', true, true, 30, false, NULL),
  ('todo_list', 'state', 'State', true, true, 40, true, NULL),
  ('todo_list', 'priority', 'Priority', true, true, 50, true, NULL),
  ('todo_list', 'dueDate', 'Due date', true, true, 60, true, NULL),
  ('todo_list', 'checked', 'Checked', true, false, 70, true, NULL)
ON CONFLICT ("entity_type", "field_key") DO NOTHING;
