import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { apiJson } from "../api/client";
import { formatEntityRef } from "../lib/entityRef";

type PlanRow = {
  id: number;
  number: number;
  title: string;
  status: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  complete: "Complete",
  archived: "Archived",
};

export function ProjectPlansPanel({
  projectId,
  canCreate,
}: {
  projectId: number;
  canCreate: boolean;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["plans", { projectId }],
    queryFn: async () => {
      const res = await apiJson<{ data: PlanRow[] }>(`/api/v1/plans?projectId=${projectId}`);
      return res.data;
    },
  });
  const create = useMutation({
    mutationFn: async (nextTitle: string) => {
      const res = await apiJson<{ data: PlanRow }>("/api/v1/plans", {
        method: "POST",
        body: JSON.stringify({ title: nextTitle, projectId }),
      });
      return res.data;
    },
    onSuccess: async () => {
      setTitle("");
      setError(null);
      await qc.invalidateQueries({ queryKey: ["plans", { projectId }] });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <section className="card project-plans">
      <h2>Plans</h2>
      {canCreate ? (
        <form
          className="project-plans__create"
          onSubmit={(event) => {
            event.preventDefault();
            const next = title.trim();
            if (!next || create.isPending) return;
            create.mutate(next);
          }}
        >
          <label htmlFor="project-plan-title">New plan</label>
          <input
            id="project-plan-title"
            type="text"
            value={title}
            maxLength={500}
            placeholder="Plan title"
            onChange={(event) => setTitle(event.target.value)}
          />
          <button type="submit" className="btn primary" disabled={!title.trim() || create.isPending}>
            Create
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="plan-board__notice" role="alert">
          {error}
        </p>
      ) : null}
      {query.isLoading ? <p className="muted">Loading plans…</p> : null}
      {query.isError ? <p role="alert">{(query.error as Error).message}</p> : null}
      {query.data && query.data.length === 0 ? <p className="muted">No plans yet.</p> : null}
      {query.data && query.data.length > 0 ? (
        <ul className="project-plans__list">
          {query.data.map((plan) => (
            <li key={plan.id}>
              <Link to={`/plans/${plan.id}`}>
                <span className="plan-board__ref">{formatEntityRef("plan", plan.number)}</span> {plan.title}
              </Link>
              <span className="muted">{STATUS_LABELS[plan.status] ?? plan.status}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
