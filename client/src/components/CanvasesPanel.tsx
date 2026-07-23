import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiJson } from "../api/client";
import type { Canvas, CanvasSummary } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { CanvasEditor } from "./CanvasEditor";
import { PencilIcon } from "./shared/PencilIcon";

type Props = { projectId: number };

export function CanvasesPanel({ projectId }: Props) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingMeta, setEditingMeta] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<CanvasSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const listQuery = useQuery({
    queryKey: ["canvases", projectId],
    queryFn: async () => {
      const res = await apiJson<{ data: CanvasSummary[] }>(`/api/v1/projects/${projectId}/canvases`);
      return res.data;
    },
  });

  const canvases = listQuery.data ?? [];
  const activeId = selectedId ?? canvases[0]?.id ?? null;

  const detailQuery = useQuery({
    queryKey: ["canvas", projectId, activeId],
    enabled: activeId != null,
    queryFn: async () => {
      const res = await apiJson<{ data: Canvas }>(`/api/v1/projects/${projectId}/canvases/${activeId}`);
      return res.data;
    },
  });

  useEffect(() => {
    if (detailQuery.data) setTitleDraft(detailQuery.data.title);
  }, [detailQuery.data?.id, detailQuery.data?.title, editingMeta]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["canvases", projectId] });
    void qc.invalidateQueries({ queryKey: ["canvas", projectId] });
    void qc.invalidateQueries({ queryKey: ["wiki", projectId] });
  };

  const createCanvas = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: Canvas }>(`/api/v1/projects/${projectId}/canvases`, {
        method: "POST",
        body: JSON.stringify({ title: "Untitled canvas" }),
      });
      return res.data;
    },
    onSuccess: (row) => {
      setSelectedId(row.id);
      setEditingMeta(true);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const patchCanvas = useMutation({
    mutationFn: async (body: { title?: string; document?: Record<string, unknown> }) => {
      if (activeId == null) throw new Error("No canvas selected");
      const res = await apiJson<{ data: Canvas }>(`/api/v1/projects/${projectId}/canvases/${activeId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return res.data;
    },
    onSuccess: (_row, vars) => {
      if (vars.title !== undefined) {
        setEditingMeta(false);
        invalidate();
      } else {
        setSaveState("saved");
        void qc.invalidateQueries({ queryKey: ["canvases", projectId] });
      }
    },
    onError: (err: Error) => {
      setError(err.message);
      setSaveState("error");
    },
  });

  const deleteCanvas = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/projects/${projectId}/canvases/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      if (pendingDelete && selectedId === pendingDelete.id) setSelectedId(null);
      setPendingDelete(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const saveTitle = () => {
    const t = titleDraft.trim();
    if (!t || t === detailQuery.data?.title) {
      setEditingMeta(false);
      setTitleDraft(detailQuery.data?.title ?? "");
      return;
    }
    void patchCanvas.mutateAsync({ title: t });
  };

  return (
    <div className="canvases-panel">
      <div className="canvases-panel__list card">
        <div className="wiki-panel__toc-head">
          <h3 style={{ margin: 0 }}>Canvases</h3>
          <button
            type="button"
            className="btn small btn-add"
            aria-label="New canvas"
            title="New canvas"
            disabled={createCanvas.isPending}
            onClick={() => createCanvas.mutate()}
          >
            +
          </button>
        </div>
        {listQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {canvases.length === 0 && !listQuery.isLoading ? (
          <p className="muted">No canvases yet — use + to create a mood board or diagram.</p>
        ) : (
          <ul className="canvases-panel__items">
            {canvases.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`canvases-panel__item${activeId === c.id ? " is-selected" : ""}`}
                  onClick={() => {
                    setSelectedId(c.id);
                    setEditingMeta(false);
                  }}
                >
                  {c.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="canvases-panel__main card">
        {error ? (
          <p className="tag-input__error" role="alert">
            {error}
          </p>
        ) : null}
        {activeId == null ? (
          <p className="muted">Select or create a canvas.</p>
        ) : detailQuery.isLoading ? (
          <p className="muted">Loading canvas…</p>
        ) : detailQuery.data ? (
          <>
            <div className="wiki-panel__main-head">
              {editingMeta ? (
                <input
                  className="canvases-panel__title-input"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveTitle();
                    } else if (e.key === "Escape") {
                      setEditingMeta(false);
                      setTitleDraft(detailQuery.data.title);
                    }
                  }}
                  autoFocus
                />
              ) : (
                <h1 className="wiki-page-title" style={{ margin: 0 }}>
                  {detailQuery.data.title}
                </h1>
              )}
              <div className="wiki-panel__main-actions">
                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  {saveState === "saving"
                    ? "Saving…"
                    : saveState === "saved"
                      ? "Saved"
                      : saveState === "error"
                        ? "Save failed"
                        : "Autosave"}
                </span>
                {!editingMeta ? (
                  <button
                    type="button"
                    className="btn small btn-icon"
                    aria-label="Rename canvas"
                    title="Rename"
                    onClick={() => setEditingMeta(true)}
                  >
                    <PencilIcon />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn small danger"
                  onClick={() => setPendingDelete(detailQuery.data)}
                >
                  Delete
                </button>
              </div>
            </div>
            <CanvasEditor
              key={detailQuery.data.id}
              canvasId={detailQuery.data.id}
              document={detailQuery.data.document ?? {}}
              onSaveDocument={(document) => {
                setSaveState("saving");
                void patchCanvas.mutateAsync({ document });
              }}
            />
          </>
        ) : (
          <p className="muted">Canvas not found.</p>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete canvas?"
        message="This permanently removes the canvas and any wiki TOC entries that point to it."
        confirmLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteCanvas.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
