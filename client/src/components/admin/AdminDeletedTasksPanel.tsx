import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../../api/client";
import { formatTaskNumber } from "../../lib/taskFields";
import { ConfirmDialog } from "../ConfirmDialog";

type DeletedTaskRow = {
  id: number;
  number: number;
  title: string;
  projectId: number | null;
  projectTitle: string | null;
  updatedAt: string;
  createdAt: string;
};

export function AdminDeletedTasksPanel() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [restoreId, setRestoreId] = useState<number | null>(null);

  const listQuery = useQuery({
    queryKey: ["admin", "deleted-tasks"],
    queryFn: async () => {
      const res = await apiJson<{ data: DeletedTaskRow[] }>("/api/v1/admin/deleted-tasks");
      return res.data;
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiJson<{ data: unknown }>(`/api/v1/admin/deleted-tasks/${id}/restore`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return res.data;
    },
    onSuccess: async () => {
      setRestoreId(null);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "deleted-tasks"] });
      await qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const rows = listQuery.data ?? [];
  const pending = rows.find((r) => r.id === restoreId) ?? null;

  return (
    <div className="admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Soft-deleted tasks stay in the database (Task numbers preserved). Restore returns a task to
        Draft.
      </p>
      {error ? (
        <p role="alert" className="tag-input__error">
          {error}
        </p>
      ) : null}
      {listQuery.isLoading ? <p className="muted">Loading…</p> : null}
      {listQuery.isError ? (
        <p role="alert" className="tag-input__error">
          {(listQuery.error as Error).message}
        </p>
      ) : null}
      {!listQuery.isLoading && rows.length === 0 ? (
        <p className="muted">No deleted tasks.</p>
      ) : null}
      {rows.length > 0 ? (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Title</th>
              <th>Project</th>
              <th>Deleted</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="task-ref task-ref--deleted">
                  <span className="task-ref__gone" aria-hidden>
                    [X]
                  </span>{" "}
                  {formatTaskNumber(row.number)}
                </td>
                <td>{row.title}</td>
                <td className="muted">{row.projectTitle ?? "—"}</td>
                <td className="muted">{new Date(row.updatedAt).toLocaleString()}</td>
                <td>
                  <button
                    type="button"
                    className="btn small primary"
                    onClick={() => {
                      setError(null);
                      setRestoreId(row.id);
                    }}
                  >
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <ConfirmDialog
        open={pending != null}
        title="Restore task?"
        message={
          pending
            ? `Restore ${formatTaskNumber(pending.number)} “${pending.title}” to Draft?`
            : ""
        }
        confirmLabel={restoreMutation.isPending ? "Restoring…" : "Restore"}
        confirmDisabled={restoreMutation.isPending}
        confirmTone="primary"
        onCancel={() => {
          if (restoreMutation.isPending) return;
          setRestoreId(null);
        }}
        onConfirm={() => {
          if (!pending || restoreMutation.isPending) return;
          restoreMutation.mutate(pending.id);
        }}
      />
    </div>
  );
}
