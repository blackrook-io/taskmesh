import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../../api/client";

type QualityGroup = {
  feature: string;
  model: string | null;
  thumbUp: number;
  thumbDown: number;
  accept: number;
  dismiss: number;
  undo: number;
  thumbUpRate: number | null;
  acceptRate: number | null;
  undoRate: number | null;
};

type QualityNote = {
  feature: string;
  model: string | null;
  kind: "thumb_up" | "thumb_down";
  note: string;
  createdAt: string;
};

type QualitySummary = {
  days: number;
  groups: QualityGroup[];
  notes: QualityNote[];
};

function percent(rate: number | null): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 100)}%`;
}

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function AdminAiQualitySection() {
  const [days, setDays] = useState(30);
  const query = useQuery({
    queryKey: ["admin", "ai-quality", days],
    queryFn: async () => {
      const json = await apiJson<{ data: QualitySummary }>(`/api/v1/admin/ai-quality?days=${days}`);
      return json.data;
    },
  });

  return (
    <section className="admin-ai-quality">
      <h2>AI quality</h2>
      <p className="muted small">
        Thumbs and accept, dismiss, and undo counts for AI output in the selected window. Grouped
        by feature and model. Notes are the optional text a user attached to a thumb.
      </p>
      <label className="field">
        <span>Window</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </label>
      {query.isLoading ? <p className="muted">Loading quality…</p> : null}
      {query.isError ? (
        <p className="error" role="alert">
          {query.error instanceof Error ? query.error.message : "Could not load quality"}
        </p>
      ) : null}
      {query.data && query.data.groups.length === 0 ? (
        <p className="muted">No feedback in this window.</p>
      ) : null}
      {query.data && query.data.groups.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Model</th>
                <th>Up</th>
                <th>Down</th>
                <th>Up rate</th>
                <th>Accept</th>
                <th>Dismiss</th>
                <th>Accept rate</th>
                <th>Undo</th>
                <th>Undo rate</th>
              </tr>
            </thead>
            <tbody>
              {query.data.groups.map((group) => (
                <tr key={`${group.feature}:${group.model ?? ""}`}>
                  <td>{group.feature}</td>
                  <td>{group.model ?? "—"}</td>
                  <td>{group.thumbUp}</td>
                  <td>{group.thumbDown}</td>
                  <td>{percent(group.thumbUpRate)}</td>
                  <td>{group.accept}</td>
                  <td>{group.dismiss}</td>
                  <td>{percent(group.acceptRate)}</td>
                  <td>{group.undo}</td>
                  <td>{percent(group.undoRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {query.data && query.data.notes.length > 0 ? (
        <>
          <h3>Recent notes</h3>
          <ul className="admin-ai-quality__notes">
            {query.data.notes.map((note) => (
              <li key={`${note.createdAt}:${note.feature}:${note.note}`}>
                <span className="muted small">
                  {note.feature}
                  {note.model ? ` · ${note.model}` : ""} · {note.kind === "thumb_up" ? "up" : "down"} ·{" "}
                  {when(note.createdAt)}
                </span>
                <div>{note.note}</div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
