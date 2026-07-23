import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson } from "../api/client";

type DiscardRow = {
  row: number;
  code: string;
  reason: string;
};

type ImportResult = {
  created: number;
  discarded: DiscardRow[];
};

type Entity = "projects" | "tasks";
type Format = "csv" | "xlsx";

export function ImportExportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [entity, setEntity] = useState<Entity>("projects");
  const [format, setFormat] = useState<Format>("xlsx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const download = (path: string) => {
    window.location.href = path;
  };

  const onImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a .csv or .xlsx file first");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiJson<{ data: ImportResult }>(`/api/v1/import/${entity}`, {
        method: "POST",
        body: fd,
      });
      setResult(res.data);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Import / Export</h1>
        <Link to="/" className="btn ghost">
          Home
        </Link>
      </div>
      <p className="muted">
        Export Projects or Tasks as CSV or XLSX. Import is <strong>insert-only</strong>: existing
        ids are never overwritten; invalid rows are discarded with reasons below.
      </p>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Export</h2>
        <div className="field" style={{ marginTop: "0.75rem" }}>
          <label htmlFor="export-format">Format</label>
          <select
            id="export-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as Format)}
          >
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV (.csv)</option>
          </select>
        </div>
        <div className="btn-row" style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            className="btn primary"
            onClick={() => download(`/api/v1/export/projects?format=${format}`)}
          >
            Export projects
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => download(`/api/v1/export/tasks?format=${format}`)}
          >
            Export tasks
          </button>
          {format === "xlsx" ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => download("/api/v1/export/bundle?format=xlsx")}
            >
              Export bundle (both sheets)
            </button>
          ) : null}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Import</h2>
        <p className="muted" style={{ marginTop: "0.35rem" }}>
          Import projects before tasks that reference new project ids. Spreadsheet <code>id</code>{" "}
          values that already exist are skipped.
        </p>
        <div className="field" style={{ marginTop: "0.75rem" }}>
          <label htmlFor="import-entity">Entity</label>
          <select
            id="import-entity"
            value={entity}
            onChange={(e) => setEntity(e.target.value as Entity)}
          >
            <option value="projects">Projects</option>
            <option value="tasks">Tasks</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="import-file">File</label>
          <input id="import-file" ref={fileRef} type="file" accept=".csv,.xlsx,.xls" />
        </div>
        <div className="btn-row">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void onImport()}>
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
        {error ? (
          <p role="alert" style={{ marginTop: "0.75rem" }}>
            {error}
          </p>
        ) : null}
        {result ? (
          <div style={{ marginTop: "1rem" }}>
            <p>
              Created <strong>{result.created}</strong> row
              {result.created === 1 ? "" : "s"}. Discarded{" "}
              <strong>{result.discarded.length}</strong>.
            </p>
            {result.discarded.length > 0 ? (
              <div className="import-discard-report">
                <h3>Discard report</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Code</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.discarded.map((d, i) => (
                      <tr key={`${d.row}-${i}`}>
                        <td>{d.row}</td>
                        <td>
                          <code>{d.code}</code>
                        </td>
                        <td>{d.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
