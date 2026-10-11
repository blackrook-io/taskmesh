CREATE TRIGGER todo_lists_purge_entity_activity AFTER DELETE ON todo_lists FOR EACH ROW EXECUTE FUNCTION purge_entity_activity('todo_list');
