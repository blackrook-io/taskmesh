import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiJson } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TodoListView } from "../components/TodoListView";
import { formatEntityRef } from "../lib/entityRef";
import type { TodoList } from "../types";

export function TodoListsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { listId: listIdParam } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const showCreate = searchParams.get("create") === "1";
  const [newTitle, setNewTitle] = useState("");
  const [pendingDelete, setPendingDelete] = useState<TodoList | null>(null);

  const listsQuery = useQuery({
    queryKey: ["todo-lists", "global"],
    queryFn: async () => {
      const res = await apiJson<{ data: TodoList[] }>("/api/v1/todo-lists?projectId=null");
      return res.data;
    },
  });

  const lists = listsQuery.data ?? [];
  const inbox = lists.find((l) => l.kind === "inbox");
  const paramId = listIdParam ? Number(listIdParam) : null;
  const activeId =
    paramId != null && Number.isFinite(paramId)
      ? paramId
      : (inbox?.id ?? lists[0]?.id ?? null);

  useEffect(() => {
    if (!listIdParam && inbox && !showCreate) {
      navigate(`/todos/${inbox.id}`, { replace: true });
    }
  }, [listIdParam, inbox, navigate, showCreate]);

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
      void qc.invalidateQueries({ queryKey: ["todo-lists"] });
      navigate(`/todos/${list.id}`);
    },
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/todo-lists/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      setPendingDelete(null);
      void qc.invalidateQueries({ queryKey: ["todo-lists"] });
      if (inbox) navigate(`/todos/${inbox.id}`);
    },
  });

  const active = lists.find((l) => l.id === activeId);

  return (
    <div>
      <div className="page-head">
        <h1>
          {active && active.kind !== "inbox" ? (
            <span className="muted">{formatEntityRef("todo_list", active.number)} </span>
          ) : null}
          {active?.kind === "inbox" ? "Unsorted" : (active?.title ?? "Lists")}
        </h1>
        {active && active.kind !== "inbox" ? (
          <button type="button" className="btn ghost small" onClick={() => setPendingDelete(active)}>
            Delete list
          </button>
        ) : null}
      </div>
      <p className="muted">
        {active?.kind === "inbox"
          ? "Ideas and tasks not on a named list (and tasks without a project)."
          : "Mix ideas and tasks. Use the middle nav to switch lists."}
      </p>

      {showCreate ? (
        <div className="card" style={{ marginTop: "1rem", maxWidth: 420 }}>
          <h3>Create list</h3>
          <div className="field">
            <label>Name</label>
            <input
              type="text"
              value={newTitle}
              autoFocus
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTitle.trim()) create.mutate();
              }}
            />
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn primary"
              disabled={!newTitle.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              Create
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setSearchParams({});
                if (inbox) navigate(`/todos/${inbox.id}`);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : activeId != null ? (
        <div style={{ marginTop: "1rem" }}>
          <TodoListView listId={activeId} />
        </div>
      ) : (
        <p className="muted">No lists yet.</p>
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete list?"
        message={`Delete “${pendingDelete?.title}”? Items are not deleted — only list membership.`}
        confirmLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
