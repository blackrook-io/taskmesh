import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { apiJson } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TodoListView } from "../components/TodoListView";
import type { TodoList } from "../types";

export function TodoListsPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [pendingDelete, setPendingDelete] = useState<TodoList | null>(null);

  const listsQuery = useQuery({
    queryKey: ["todo-lists"],
    queryFn: async () => {
      const res = await apiJson<{ data: TodoList[] }>("/api/v1/todo-lists");
      return res.data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: TodoList }>("/api/v1/todo-lists", {
        method: "POST",
        body: JSON.stringify({ title: newTitle.trim(), projectId: null }),
      });
      return res.data;
    },
    onSuccess: (list) => {
      setNewTitle("");
      setSelectedId(list.id);
      void qc.invalidateQueries({ queryKey: ["todo-lists"] });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/todo-lists/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      if (pendingDelete && selectedId === pendingDelete.id) setSelectedId(null);
      setPendingDelete(null);
      void qc.invalidateQueries({ queryKey: ["todo-lists"] });
    },
  });

  const lists = listsQuery.data ?? [];
  const activeId = selectedId ?? lists.find((l) => l.kind === "inbox")?.id ?? lists[0]?.id ?? null;

  return (
    <div>
      <div className="page-head">
        <h1>To Do lists</h1>
      </div>
      <p className="muted">Mix ideas and tasks. Unsorted is always available.</p>

      <div className="split-panel" style={{ marginTop: "1rem" }}>
        <div className="card">
          <h3>Lists</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 0.75rem" }}>
            {lists.map((l) => (
              <li key={l.id} style={{ marginBottom: "0.35rem", display: "flex", gap: "0.35rem" }}>
                <button
                  type="button"
                  className={`btn small${activeId === l.id ? " primary" : " ghost"}`}
                  style={{ flex: 1, justifyContent: "flex-start" }}
                  onClick={() => setSelectedId(l.id)}
                >
                  {l.title}
                  {l.projectId != null ? ` · P${l.projectId}` : ""}
                </button>
                {l.kind !== "inbox" ? (
                  <button type="button" className="btn small ghost" onClick={() => setPendingDelete(l)}>
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="field">
            <label>New list</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTitle.trim()) create.mutate();
              }}
            />
          </div>
          <button
            type="button"
            className="btn primary"
            style={{ width: "100%" }}
            disabled={!newTitle.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            Create list
          </button>
          <p className="muted" style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
            Project-scoped lists also appear under each project’s To Dos tab.
          </p>
          <Link to="/projects" className="muted" style={{ fontSize: "0.85rem" }}>
            Browse projects →
          </Link>
        </div>
        <div className="card">
          {activeId != null ? (
            <>
              <h2 style={{ marginTop: 0 }}>{lists.find((l) => l.id === activeId)?.title ?? "List"}</h2>
              <TodoListView listId={activeId} />
            </>
          ) : (
            <p className="muted">No lists yet.</p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete list?"
        message="Items are removed from the list; ideas and tasks are kept."
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
