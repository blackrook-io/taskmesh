import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";

type BackupItem = {
  id: string;
  createdAt: string;
  pgDumpOk: boolean;
  uploadsOk: boolean;
  sqlFile: string | null;
  uploadsFile: string | null;
  bytes: number;
  error: string | null;
  health: "ok" | "warn" | "missing";
  ageHours: number | null;
};

type BackupsPayload = {
  health: "ok" | "warn" | "missing";
  freshHours: number;
  items: BackupItem[];
};

type Schedule = {
  enabled: boolean;
  hour: number;
  minute: number;
  retainDays: number;
};

type RestoreResult = {
  backupId: string;
  safetyBackupId: string | null;
  databaseRestored: boolean;
  uploadsRestored: boolean;
  error: string | null;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function healthLabel(h: string): string {
  if (h === "ok") return "Healthy";
  if (h === "warn") return "Stale";
  return "No backup";
}

export function BackupsPage() {
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<BackupItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BackupItem | null>(null);

  const listQuery = useQuery({
    queryKey: ["backups"],
    queryFn: async () => {
      const res = await apiJson<{ data: BackupsPayload }>("/api/v1/backups");
      return res.data;
    },
    refetchInterval: 15_000,
  });

  const scheduleQuery = useQuery({
    queryKey: ["backup-schedule"],
    queryFn: async () => {
      const res = await apiJson<{ data: Schedule }>("/api/v1/backups/schedule");
      return res.data;
    },
  });

  const [draft, setDraft] = useState<Schedule | null>(null);
  const schedule = draft ?? scheduleQuery.data ?? null;

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: BackupItem }>("/api/v1/backups/run", { method: "POST" });
      return res.data;
    },
    onSuccess: (m) => {
      setMessage(
        m.pgDumpOk
          ? `Backup ${m.id} completed (${formatBytes(m.bytes)}).`
          : `Backup ${m.id} finished with errors: ${m.error ?? "unknown"}`,
      );
      void qc.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiJson<{ data: RestoreResult }>(`/api/v1/backups/${id}/restore`, {
        method: "POST",
        body: JSON.stringify({ restoreUploads: true, takeSafetyBackup: true }),
      });
      return res.data;
    },
    onSuccess: (r) => {
      setPendingRestore(null);
      setMessage(
        r.databaseRestored
          ? `Restored backup ${r.backupId}${r.safetyBackupId ? ` (safety snapshot ${r.safetyBackupId} saved first)` : ""}.${r.uploadsRestored ? " Uploads restored." : ""}${r.error ? ` Note: ${r.error}` : ""}`
          : `Restore failed: ${r.error ?? "unknown"}`,
      );
      void qc.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (e: Error) => {
      setPendingRestore(null);
      setMessage(e.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiJson<{ data: { id: string } }>(`/api/v1/backups/${id}`, {
        method: "DELETE",
      });
      return res.data;
    },
    onSuccess: (r) => {
      setPendingDelete(null);
      setMessage(`Deleted backup ${r.id}.`);
      void qc.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (e: Error) => {
      setPendingDelete(null);
      setMessage(e.message);
    },
  });

  const saveSchedule = useMutation({
    mutationFn: async (body: Schedule) => {
      const res = await apiJson<{ data: Schedule }>("/api/v1/backups/schedule", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return res.data;
    },
    onSuccess: (data) => {
      setDraft(null);
      void qc.setQueryData(["backup-schedule"], data);
      setMessage("Schedule saved. In-process scheduler uses these settings while the API is running.");
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const busy =
    runMutation.isPending || restoreMutation.isPending || deleteMutation.isPending;

  return (
    <div>
      <div className="page-head">
        <h1>Backups</h1>
      </div>
      <p className="muted">
        Database dumps and upload archives under the configured backup directory. A backup is{" "}
        <strong>healthy</strong> when the latest successful dump is less than{" "}
        {listQuery.data?.freshHours ?? 36} hours old. Restore replaces the current database (and
        uploads when present) after confirmation; a safety backup is taken first. Delete removes a
        backup folder from disk (useful for discarding unwanted safety snapshots).
      </p>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <div className="btn-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <p style={{ margin: 0 }}>
            Status:{" "}
            <strong className={`backup-health backup-health--${listQuery.data?.health ?? "missing"}`}>
              {listQuery.isLoading ? "…" : healthLabel(listQuery.data?.health ?? "missing")}
            </strong>
          </p>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => {
              setMessage(null);
              runMutation.mutate();
            }}
          >
            {runMutation.isPending ? "Running…" : "Run backup now"}
          </button>
        </div>
        {message ? (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            {message}
          </p>
        ) : null}
      </section>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Schedule</h2>
        <p className="muted" style={{ marginTop: "0.35rem" }}>
          While TaskMesh is running, backups fire at the local time below. For dumps when the app is
          stopped, see INSTALL.md (systemd timer).
        </p>
        {schedule ? (
          <div className="backup-schedule-form" style={{ marginTop: "0.75rem" }}>
            <label className="backup-check">
              <input
                type="checkbox"
                checked={schedule.enabled}
                onChange={(e) => setDraft({ ...schedule, enabled: e.target.checked })}
              />
              Enabled
            </label>
            <div className="field">
              <label htmlFor="backup-hour">Hour (0–23)</label>
              <input
                id="backup-hour"
                type="number"
                min={0}
                max={23}
                value={schedule.hour}
                onChange={(e) => setDraft({ ...schedule, hour: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label htmlFor="backup-minute">Minute (0–59)</label>
              <input
                id="backup-minute"
                type="number"
                min={0}
                max={59}
                value={schedule.minute}
                onChange={(e) => setDraft({ ...schedule, minute: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label htmlFor="backup-retain">Retain days</label>
              <input
                id="backup-retain"
                type="number"
                min={1}
                max={365}
                value={schedule.retainDays}
                onChange={(e) => setDraft({ ...schedule, retainDays: Number(e.target.value) })}
              />
            </div>
            <button
              type="button"
              className="btn primary"
              disabled={saveSchedule.isPending || !draft}
              onClick={() => draft && saveSchedule.mutate(draft)}
            >
              Save schedule
            </button>
          </div>
        ) : (
          <p className="muted">Loading schedule…</p>
        )}
      </section>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Recent backups</h2>
        {listQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {listQuery.isError ? (
          <p role="alert">{(listQuery.error as Error).message}</p>
        ) : null}
        {(listQuery.data?.items.length ?? 0) === 0 && !listQuery.isLoading ? (
          <p className="muted">No backups yet. Run one now.</p>
        ) : null}
        {(listQuery.data?.items.length ?? 0) > 0 ? (
          <table className="data-table" style={{ marginTop: "0.5rem" }}>
            <thead>
              <tr>
                <th>When</th>
                <th>Health</th>
                <th>DB</th>
                <th>Uploads</th>
                <th>Size</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data!.items.map((b) => (
                <tr key={b.id}>
                  <td>
                    <code>{b.id}</code>
                    <div className="muted" style={{ fontSize: "0.8rem" }}>
                      {new Date(b.createdAt).toLocaleString()}
                    </div>
                  </td>
                  <td>
                    <span className={`backup-health backup-health--${b.health}`}>
                      {healthLabel(b.health)}
                    </span>
                  </td>
                  <td>{b.pgDumpOk ? "OK" : "Fail"}</td>
                  <td>{b.uploadsOk ? "OK" : "Fail"}</td>
                  <td>{formatBytes(b.bytes)}</td>
                  <td className="muted">{b.error ?? "—"}</td>
                  <td>
                    <div className="btn-row" style={{ flexWrap: "nowrap", gap: "0.35rem" }}>
                      <button
                        type="button"
                        className="btn small danger"
                        disabled={busy || !b.pgDumpOk}
                        title={b.pgDumpOk ? "Restore this backup" : "No database dump to restore"}
                        onClick={() => {
                          setMessage(null);
                          setPendingRestore(b);
                        }}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="btn small ghost"
                        disabled={busy}
                        title="Delete this backup from disk"
                        onClick={() => {
                          setMessage(null);
                          setPendingDelete(b);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <ConfirmDialog
        open={pendingRestore != null}
        title="Restore this backup?"
        message={
          pendingRestore
            ? `This permanently replaces the current database${pendingRestore.uploadsFile ? " and uploads" : ""} with backup ${pendingRestore.id} (${new Date(pendingRestore.createdAt).toLocaleString()}). A safety backup of the current state is taken first. Continue?`
            : ""
        }
        confirmLabel={restoreMutation.isPending ? "Restoring…" : "Restore"}
        onCancel={() => {
          if (!restoreMutation.isPending) setPendingRestore(null);
        }}
        onConfirm={() => {
          if (pendingRestore && !restoreMutation.isPending) {
            restoreMutation.mutate(pendingRestore.id);
          }
        }}
      />

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete this backup?"
        message={
          pendingDelete
            ? `Permanently delete backup ${pendingDelete.id} (${new Date(pendingDelete.createdAt).toLocaleString()}) from disk? This cannot be undone.`
            : ""
        }
        confirmLabel={deleteMutation.isPending ? "Deleting…" : "Delete"}
        onCancel={() => {
          if (!deleteMutation.isPending) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete && !deleteMutation.isPending) {
            deleteMutation.mutate(pendingDelete.id);
          }
        }}
      />
    </div>
  );
}
