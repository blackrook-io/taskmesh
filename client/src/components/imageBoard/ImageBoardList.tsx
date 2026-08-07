import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiJson } from "../../api/client";
import type { ImageBoard, ImageBoardSummary, Project } from "../../types";
import { ConfirmDialog } from "../ConfirmDialog";

type Props = {
  /** When set, list/create boards for this project only. */
  projectId?: number;
  heading?: string;
};

export function ImageBoardList({ projectId, heading = "Image boards" }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [linkId, setLinkId] = useState<number | null>(null);

  const listPath =
    projectId != null
      ? `/api/v1/image-boards?projectId=${projectId}`
      : "/api/v1/image-boards";

  const queryKey = ["image-boards", projectId ?? "all"] as const;

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await apiJson<{ data: ImageBoardSummary[] }>(listPath);
      return res.data;
    },
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await apiJson<{ data: Project[] }>("/api/v1/projects");
      return res.data;
    },
    enabled: linkId != null,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: ImageBoard }>("/api/v1/image-boards", {
        method: "POST",
        body: JSON.stringify({
          title: "Untitled image board",
          ...(projectId != null ? { projectId } : { projectId: null }),
        }),
      });
      return res.data;
    },
    onSuccess: (board) => {
      void qc.invalidateQueries({ queryKey: ["image-boards"] });
      navigate(`/image-board/${board.id}`);
    },
  });

  const patchMut = useMutation({
    mutationFn: async (payload: {
      id: number;
      title?: string;
      projectId?: number | null;
    }) => {
      const res = await apiJson<{ data: ImageBoardSummary }>(`/api/v1/image-boards/${payload.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(payload.title !== undefined ? { title: payload.title } : {}),
          ...(payload.projectId !== undefined ? { projectId: payload.projectId } : {}),
        }),
      });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["image-boards"] });
      setRenamingId(null);
      setLinkId(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await apiJson<undefined>(`/api/v1/image-boards/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["image-boards"] });
      setDeleteId(null);
    },
  });

  const deleteTarget = data?.find((b) => b.id === deleteId) ?? null;

  if (isLoading) return <p className="muted">Loading image boards…</p>;
  if (error) return <p role="alert">{(error as Error).message}</p>;

  return (
    <div className="image-board-list">
      <div className="page-head">
        <h1>{heading}</h1>
        <button
          type="button"
          className="btn primary"
          disabled={createMut.isPending}
          onClick={() => createMut.mutate()}
        >
          New board
        </button>
      </div>

      {createMut.isError ? (
        <p role="alert">{(createMut.error as Error).message}</p>
      ) : null}

      <div className="grid">
        {(data ?? []).map((board) => (
          <div key={board.id} className="card image-board-list__card">
            {renamingId === board.id ? (
              <form
                className="image-board-list__rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  const title = renameValue.trim();
                  if (!title) return;
                  patchMut.mutate({ id: board.id, title });
                }}
              >
                <input
                  className="input"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  aria-label="Board title"
                />
                <div className="btn-row">
                  <button type="submit" className="btn small primary" disabled={patchMut.isPending}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => setRenamingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <Link to={`/image-board/${board.id}`} className="image-board-list__title-link">
                  <h3>{board.title}</h3>
                </Link>
                <p className="muted">
                  {board.projectName ? (
                    <>
                      Project:{" "}
                      {board.projectId != null ? (
                        <Link to={`/projects/${board.projectId}?tab=images`}>{board.projectName}</Link>
                      ) : (
                        board.projectName
                      )}
                    </>
                  ) : (
                    "Standalone"
                  )}{" "}
                  · updated {new Date(board.updatedAt).toLocaleString()}
                </p>
                <div className="btn-row">
                  <Link to={`/image-board/${board.id}`} className="btn small primary">
                    Open
                  </Link>
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => {
                      setRenamingId(board.id);
                      setRenameValue(board.title);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => setLinkId(board.id)}
                  >
                    {board.projectId == null ? "Link project" : "Change project"}
                  </button>
                  {board.projectId != null ? (
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() => patchMut.mutate({ id: board.id, projectId: null })}
                    >
                      Detach
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn small danger"
                    onClick={() => setDeleteId(board.id)}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}

            {linkId === board.id ? (
              <div className="image-board-list__link">
                <label className="muted">
                  Link to project
                  <select
                    className="input"
                    defaultValue={board.projectId ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) {
                        patchMut.mutate({ id: board.id, projectId: null });
                        return;
                      }
                      patchMut.mutate({ id: board.id, projectId: Number(v) });
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
                <button type="button" className="btn small ghost" onClick={() => setLinkId(null)}>
                  Close
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {(data ?? []).length === 0 ? (
        <p className="muted">
          No image boards yet. Create one to collect reference images on an infinite canvas.
        </p>
      ) : null}

      <ConfirmDialog
        open={deleteId != null}
        title="Delete image board"
        message={
          deleteTarget
            ? `Delete “${deleteTarget.title}”? This cannot be undone.`
            : "Delete this image board?"
        }
        onConfirm={() => {
          if (deleteId != null) deleteMut.mutate(deleteId);
        }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
