import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../../api/client";
import { ConfirmDialog } from "../ConfirmDialog";

type AdminTemplate = {
  id: number;
  name: string;
  body: string;
  projectId: number | null;
  isGlobal: boolean;
  projectTitle: string | null;
  createdAt: string;
  updatedAt: string;
};

export function AdminTemplatesPanel() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const templatesQuery = useQuery({
    queryKey: ["admin", "task-description-templates"],
    queryFn: async () => {
      const res = await apiJson<{ data: AdminTemplate[] }>(
        "/api/v1/admin/task-description-templates",
      );
      return res.data;
    },
  });

  const patchMutation = useMutation({
    mutationFn: async ({
      id,
      isGlobal,
      name,
    }: {
      id: number;
      isGlobal?: boolean;
      name?: string;
    }) => {
      const res = await apiJson<{ data: AdminTemplate }>(
        `/api/v1/admin/task-description-templates/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            ...(isGlobal !== undefined ? { isGlobal } : {}),
            ...(name !== undefined ? { name } : {}),
          }),
        },
      );
      return res.data;
    },
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "task-description-templates"] });
      await qc.invalidateQueries({ queryKey: ["task-description-templates"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/admin/task-description-templates/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: async () => {
      setDeleteId(null);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "task-description-templates"] });
      await qc.invalidateQueries({ queryKey: ["task-description-templates"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const rows = templatesQuery.data ?? [];
  const pendingDelete = rows.find((r) => r.id === deleteId) ?? null;

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Task Description templates saved from Edit Task. Mark Global to make a template
        available across all projects.
      </p>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {templatesQuery.isLoading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No templates yet. Save one from a task Description.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Project</th>
                <th>Global</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <button
                      type="button"
                      className="btn ghost small"
                      title="Rename"
                      onClick={() => {
                        const next = window.prompt("Template name", row.name);
                        if (next == null) return;
                        const trimmed = next.trim();
                        if (!trimmed || trimmed === row.name) return;
                        patchMutation.mutate({ id: row.id, name: trimmed });
                      }}
                    >
                      {row.name}
                    </button>
                  </td>
                  <td className="muted">
                    {row.isGlobal
                      ? "—"
                      : (row.projectTitle ?? (row.projectId == null ? "Unsorted" : `P${row.projectId}`))}
                  </td>
                  <td>
                    <label className="admin-toggle">
                      <input
                        type="checkbox"
                        checked={row.isGlobal}
                        disabled={patchMutation.isPending}
                        onChange={(e) =>
                          patchMutation.mutate({
                            id: row.id,
                            isGlobal: e.target.checked,
                          })
                        }
                      />
                      <span className="sr-only">Global</span>
                    </label>
                  </td>
                  <td className="muted">
                    {new Date(row.updatedAt).toLocaleString()}
                  </td>
                  <td className="admin-table__actions">
                    <button
                      type="button"
                      className="btn danger small"
                      onClick={() => setDeleteId(row.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete template?"
        message={
          pendingDelete
            ? `Delete “${pendingDelete.name}”? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId != null) deleteMutation.mutate(deleteId);
        }}
      />
    </div>
  );
}
