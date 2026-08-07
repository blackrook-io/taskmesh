import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiJson } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ImageBoardViewport } from "../components/imageBoard/ImageBoardViewport";
import {
  documentToRecord,
  emptyImageBoardDocument,
  normalizeDocument,
  type ImageBoardDocument,
} from "../lib/imageBoardDocument";
import type { ImageBoard, Project } from "../types";

export function ImageBoardEditorPage() {
  const { id } = useParams();
  const boardId = Number(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [doc, setDoc] = useState<ImageBoardDocument>(emptyImageBoardDocument());
  const [title, setTitle] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const titleTimer = useRef<number | undefined>(undefined);

  const { data, isLoading, error } = useQuery({
    queryKey: ["image-board", boardId],
    enabled: Number.isFinite(boardId) && boardId > 0,
    queryFn: async () => {
      const res = await apiJson<{ data: ImageBoard }>(`/api/v1/image-boards/${boardId}`);
      return res.data;
    },
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await apiJson<{ data: Project[] }>("/api/v1/projects");
      return res.data;
    },
  });

  useEffect(() => {
    if (!data) return;
    setDoc(normalizeDocument(data.document));
    setTitle(data.title);
  }, [data]);

  useEffect(() => {
    return () => {
      window.clearTimeout(saveTimer.current);
      window.clearTimeout(titleTimer.current);
    };
  }, []);

  const patchMut = useMutation({
    mutationFn: async (body: {
      document?: Record<string, unknown>;
      title?: string;
      projectId?: number | null;
    }) => {
      const res = await apiJson<{ data: ImageBoard }>(`/api/v1/image-boards/${boardId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return res.data;
    },
    onSuccess: (row) => {
      qc.setQueryData(["image-board", boardId], row);
      void qc.invalidateQueries({ queryKey: ["image-boards"] });
    },
  });

  const patchMutRef = useRef(patchMut.mutate);
  patchMutRef.current = patchMut.mutate;

  const deleteMut = useMutation({
    mutationFn: async () => {
      await apiJson<undefined>(`/api/v1/image-boards/${boardId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["image-boards"] });
      navigate("/image-board");
    },
  });

  const scheduleDocSave = useCallback((next: ImageBoardDocument) => {
    setDoc(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      patchMutRef.current({ document: documentToRecord(next) });
    }, 900);
  }, []);

  const onTitleChange = (value: string) => {
    setTitle(value);
    window.clearTimeout(titleTimer.current);
    titleTimer.current = window.setTimeout(() => {
      const trimmed = value.trim();
      if (trimmed) patchMutRef.current({ title: trimmed });
    }, 600);
  };

  if (!Number.isFinite(boardId) || boardId <= 0) {
    return <p role="alert">Invalid image board id</p>;
  }
  if (isLoading) return <p className="muted">Loading board…</p>;
  if (error || !data) return <p role="alert">{(error as Error)?.message ?? "Not found"}</p>;

  const backTo =
    data.projectId != null ? `/projects/${data.projectId}?tab=images` : "/image-board";

  return (
    <div className="ib-editor">
      <div className="ib-editor__bar">
        <Link to={backTo} className="btn small ghost">
          ← Back
        </Link>
        <input
          className="input ib-editor__title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          aria-label="Board title"
        />
        <label className="ib-editor__project muted">
          Project
          <select
            className="input"
            value={data.projectId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              patchMut.mutate({ projectId: v ? Number(v) : null });
            }}
          >
            <option value="">Standalone</option>
            {(projectsQuery.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <span className="muted ib-editor__save">
          {patchMut.isPending ? "Saving…" : patchMut.isError ? "Save failed" : "Saved"}
        </span>
        <button type="button" className="btn small danger" onClick={() => setConfirmDelete(true)}>
          Delete
        </button>
      </div>

      <ImageBoardViewport document={doc} onChange={scheduleDocSave} />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete image board"
        message={`Delete “${data.title}”? This cannot be undone.`}
        onConfirm={() => deleteMut.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
