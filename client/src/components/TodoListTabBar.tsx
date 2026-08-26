import { useEffect, useState } from "react";
import { formatEntityRef } from "../lib/entityRef";
import type { TodoList } from "../types";

function TodoListTab({
  list,
  active,
  empty,
  onSelect,
  onRename,
  onRequestDelete,
}: {
  list: TodoList;
  active: boolean;
  empty: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onRequestDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(list.title);

  useEffect(() => {
    if (!editing) setDraft(list.title);
  }, [list.title, editing]);

  const commitRename = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== list.title) onRename(next);
    else setDraft(list.title);
  };

  const refLabel = formatEntityRef("todo_list", list.number);

  return (
    <div
      className={`board-tab board-tab--static${active ? " active" : ""}`}
      role="tab"
      aria-selected={active}
    >
      {editing ? (
        <input
          className="board-tab__rename"
          value={draft}
          autoFocus
          aria-label="Rename list"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setDraft(list.title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="board-tab__label"
          title={refLabel}
          onClick={onSelect}
          onDoubleClick={(e) => {
            e.preventDefault();
            setEditing(true);
          }}
        >
          {list.title}
        </button>
      )}
      {empty ? (
        <button
          type="button"
          className="board-tab__close"
          aria-label={`Delete ${list.title}`}
          title="Delete empty list"
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete();
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

type Props = {
  lists: TodoList[];
  activeId: number | null;
  itemCounts: Record<number, number>;
  creating?: boolean;
  onSelect: (id: number) => void;
  onCreate: (title: string) => void;
  onRename: (id: number, title: string) => void;
  onRequestDelete: (list: TodoList) => void;
};

export function TodoListTabBar({
  lists,
  activeId,
  itemCounts,
  creating = false,
  onSelect,
  onCreate,
  onRename,
  onRequestDelete,
}: Props) {
  const [creatingNew, setCreatingNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  useEffect(() => {
    if (!creating) {
      setCreatingNew(false);
      setNewTitle("");
    }
  }, [creating]);

  const commitCreate = () => {
    const title = newTitle.trim();
    if (!title) {
      setCreatingNew(false);
      setNewTitle("");
      return;
    }
    onCreate(title);
  };

  const cancelCreate = () => {
    setCreatingNew(false);
    setNewTitle("");
  };

  return (
    <div className="board-tabs" role="tablist" aria-label="Project To Do lists">
      {lists.map((list) => (
        <TodoListTab
          key={list.id}
          list={list}
          active={list.id === activeId}
          empty={itemCounts[list.id] === 0}
          onSelect={() => onSelect(list.id)}
          onRename={(title) => onRename(list.id, title)}
          onRequestDelete={() => onRequestDelete(list)}
        />
      ))}
      {creatingNew ? (
        <div className="board-tab board-tab--static board-tab--new-input">
          <input
            className="board-tab__rename board-tab__rename--wide"
            value={newTitle}
            autoFocus
            disabled={creating}
            placeholder="List title"
            aria-label="New list title"
            onChange={(e) => setNewTitle(e.target.value)}
            onBlur={() => {
              if (newTitle.trim()) commitCreate();
              else cancelCreate();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitCreate();
              if (e.key === "Escape") cancelCreate();
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          className="board-tab board-tab--add board-tab--new-label"
          aria-label="Create list"
          disabled={creating}
          onClick={() => setCreatingNew(true)}
        >
          +New
        </button>
      )}
    </div>
  );
}
