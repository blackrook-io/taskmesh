import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../api/client";
import type { ProjectPhase } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = {
  projectId: number;
  phases: ProjectPhase[];
};

export function PhaseManager({ projectId, phases }: Props) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ProjectPhase | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["phases", projectId] });
    void qc.invalidateQueries({ queryKey: ["tasks", projectId] });
  };

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: ProjectPhase }>(`/api/v1/projects/${projectId}/phases`, {
        method: "POST",
        body: JSON.stringify({ name: newName.trim() }),
      });
      return res.data;
    },
    onSuccess: () => {
      setNewName("");
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const rename = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const res = await apiJson<{ data: ProjectPhase }>(
        `/api/v1/projects/${projectId}/phases/${id}`,
        { method: "PATCH", body: JSON.stringify({ name }) },
      );
      return res.data;
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/projects/${projectId}/phases/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      setPendingDelete(null);
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const reorder = useMutation({
    mutationFn: async (orderedPhaseIds: number[]) => {
      const res = await apiJson<{ data: ProjectPhase[] }>(
        `/api/v1/projects/${projectId}/phases/reorder`,
        { method: "PATCH", body: JSON.stringify({ orderedPhaseIds }) },
      );
      return res.data;
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const move = (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= phases.length) return;
    const ids = phases.map((p) => p.id);
    const tmp = ids[index]!;
    ids[index] = ids[next]!;
    ids[next] = tmp;
    void reorder.mutateAsync(ids);
  };

  return (
    <div className="card phase-manager">
      <h3>Phases</h3>
      <ul className="phase-manager__list">
        {phases.map((phase, index) => (
          <li key={phase.id} className="phase-manager__row">
            <input
              type="text"
              className="phase-manager__name"
              defaultValue={phase.name}
              aria-label={`Phase name ${phase.name}`}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== phase.name) rename.mutate({ id: phase.id, name });
                else e.target.value = phase.name;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            <div className="phase-manager__ops">
              <button
                type="button"
                className="btn small ghost"
                disabled={index === 0 || reorder.isPending}
                aria-label="Move phase up"
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn small ghost"
                disabled={index === phases.length - 1 || reorder.isPending}
                aria-label="Move phase down"
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="btn small ghost"
                disabled={phases.length <= 1}
                aria-label={`Delete phase ${phase.name}`}
                onClick={() => setPendingDelete(phase)}
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="phase-manager__add">
        <input
          type="text"
          placeholder="New phase name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newName.trim()) create.mutate();
          }}
        />
        <button
          type="button"
          className="btn small primary"
          disabled={!newName.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          Add phase
        </button>
      </div>
      {error ? (
        <p className="tag-input__error" role="alert">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete phase?"
        message={
          pendingDelete
            ? `Tasks in “${pendingDelete.name}” will move to another phase.`
            : "Tasks will be reassigned."
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
