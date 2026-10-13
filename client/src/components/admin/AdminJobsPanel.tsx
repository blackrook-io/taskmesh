import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "../../api/client";
import { ConfirmDialog } from "../ConfirmDialog";
import {
  AdminRangeToggle,
  AdminUsageChart,
  type UsageRange,
} from "./AdminUsageChart";

type QueueCounts = {
  name: string;
  label: string;
  created: number;
  active: number;
  retry: number;
  failed: number;
};

type ActivityPoint = {
  t: string;
  completed: number;
  failed: number;
};

type FailedJob = {
  id: string;
  name: string;
  label: string;
  retryCount: number;
  createdOn: string;
  completedOn: string | null;
  error: string | null;
};

type JobSummary = {
  range: UsageRange;
  queues: QueueCounts[];
  series: ActivityPoint[];
  failedJobs: FailedJob[];
  knowledgeIndex?: { status: "idle" | "running" };
};

const EMPTY_SERIES: ActivityPoint[] = [];

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function AdminJobsPanel() {
  const qc = useQueryClient();
  const [range, setRange] = useState<UsageRange>("1d");
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rebuildOpen, setRebuildOpen] = useState(false);

  const summaryQuery = useQuery({
    queryKey: ["admin", "jobs", range],
    queryFn: async () => {
      const res = await apiJson<{ data: JobSummary }>(`/api/v1/admin/jobs?range=${range}`);
      return res.data;
    },
    refetchInterval: 15_000,
  });

  const retryMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiJson(`/api/v1/admin/jobs/${id}/retry`, { method: "POST" });
    },
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "jobs"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiJson(`/api/v1/admin/jobs/${id}`, { method: "DELETE" });
    },
    onSuccess: async () => {
      setDeleteId(null);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "jobs"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const rebuildMutation = useMutation({
    mutationFn: async () => {
      await apiJson("/api/v1/admin/jobs/knowledge/rebuild", { method: "POST" });
    },
    onSuccess: async () => {
      setRebuildOpen(false);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "jobs"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const series = summaryQuery.data?.series ?? EMPTY_SERIES;
  const queues = summaryQuery.data?.queues ?? [];
  const failedJobs = summaryQuery.data?.failedJobs ?? [];
  const pendingDelete = failedJobs.find((job) => job.id === deleteId) ?? null;
  const knowledgeStatus = summaryQuery.data?.knowledgeIndex?.status ?? "idle";

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Background jobs stay in Postgres across API restarts. A job that keeps failing lands here
        after its retries. Retry runs it again. Delete removes it.
      </p>

      <AdminRangeToggle range={range} onChange={setRange} />

      {error ? (
        <p role="alert" className="tag-input__error">
          {error}
        </p>
      ) : null}
      {summaryQuery.isLoading ? <p className="muted">Loading…</p> : null}
      {summaryQuery.isError ? (
        <p role="alert" className="tag-input__error">
          {(summaryQuery.error as Error).message}
        </p>
      ) : null}

      {summaryQuery.data ? (
        <>
          <h4 className="admin-db-heading">Knowledge index</h4>
          <p className="muted">
            {knowledgeStatus === "running" ? "Rebuild in progress." : "Idle."}
          </p>
          <button
            type="button"
            className="btn small primary"
            disabled={knowledgeStatus === "running" || rebuildMutation.isPending}
            onClick={() => {
              setError(null);
              setRebuildOpen(true);
            }}
          >
            Rebuild knowledge index
          </button>

          <h4 className="admin-db-heading">Queue depth</h4>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Queue</th>
                <th>Created</th>
                <th>Active</th>
                <th>Retry</th>
                <th>Failed</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((queue) => (
                <tr key={queue.name}>
                  <td>{queue.label}</td>
                  <td>{queue.created}</td>
                  <td>{queue.active}</td>
                  <td>{queue.retry}</td>
                  <td>{queue.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 className="admin-db-heading">Completed</h4>
          <AdminUsageChart
            series={series}
            valueOf={(point) => point.completed}
            label="Completed jobs"
            color="var(--accent, #7dcea0)"
          />
          <h4 className="admin-db-heading">Failed</h4>
          <AdminUsageChart
            series={series}
            valueOf={(point) => point.failed}
            label="Failed jobs"
            color="#e07a5f"
          />

          <h4 className="admin-db-heading">Dead letter</h4>
          {failedJobs.length === 0 ? (
            <p className="muted">No failed jobs.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Queue</th>
                  <th>Retries</th>
                  <th>Failed</th>
                  <th>Error</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {failedJobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.label}</td>
                    <td>{job.retryCount}</td>
                    <td className="muted">{formatWhen(job.completedOn ?? job.createdOn)}</td>
                    <td className="muted">{job.error ?? "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="btn small primary"
                        disabled={retryMutation.isPending}
                        onClick={() => {
                          setError(null);
                          retryMutation.mutate(job.id);
                        }}
                      >
                        Retry
                      </button>{" "}
                      <button
                        type="button"
                        className="btn small danger"
                        onClick={() => {
                          setError(null);
                          setDeleteId(job.id);
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}

      <ConfirmDialog
        open={rebuildOpen}
        title="Rebuild knowledge index?"
        message="Walk every record and refresh full-text and embeddings. A rebuild already in progress keeps going from where it left off."
        confirmLabel={rebuildMutation.isPending ? "Starting…" : "Rebuild"}
        confirmDisabled={rebuildMutation.isPending}
        onConfirm={() => rebuildMutation.mutate()}
        onCancel={() => setRebuildOpen(false)}
      />
      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete failed job?"
        message={
          pendingDelete
            ? `Remove this failed ${pendingDelete.label} job? This cannot be undone.`
            : ""
        }
        confirmLabel={deleteMutation.isPending ? "Deleting…" : "Delete"}
        confirmDisabled={deleteMutation.isPending}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
        }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
