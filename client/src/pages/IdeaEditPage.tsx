import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { apiJson } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MarkdownEditor } from "../components/shared/MarkdownEditor";
import { TagInput } from "../components/shared/TagInput";
import type { Idea, Project } from "../types";

export function IdeaEditPage() {
  const { id } = useParams();
  const isNew = id === "new";
  const ideaId = isNew ? null : Number(id);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: idea, isLoading } = useQuery({
    queryKey: ["idea", ideaId],
    enabled: !isNew && ideaId != null && !Number.isNaN(ideaId),
    queryFn: async () => {
      const res = await apiJson<{ data: Idea }>(`/api/v1/ideas/${ideaId}`);
      return res.data;
    },
  });

  useEffect(() => {
    if (idea) {
      setTitle(idea.title);
      setBody(idea.body ?? "");
    }
  }, [idea]);

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) {
        const res = await apiJson<{ data: Idea }>("/api/v1/ideas", {
          method: "POST",
          body: JSON.stringify({ title, body }),
        });
        return res.data;
      }
      const res = await apiJson<{ data: Idea }>(`/api/v1/ideas/${ideaId}`, {
        method: "PATCH",
        body: JSON.stringify({ title, body }),
      });
      return res.data;
    },
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ["ideas"] });
      if (isNew) navigate(`/ideas/${row.id}`, { replace: true });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      await apiJson(`/api/v1/ideas/${ideaId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ideas"] });
      navigate("/ideas");
    },
  });

  const convert = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: Project }>(`/api/v1/ideas/${ideaId}/convert-to-project`, {
        method: "POST",
      });
      return res.data;
    },
    onSuccess: (project) => {
      void qc.invalidateQueries({ queryKey: ["ideas"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${project.id}`);
    },
  });

  if (!isNew && (ideaId == null || Number.isNaN(ideaId))) {
    return <p className="muted">Invalid idea id.</p>;
  }
  if (!isNew && isLoading) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="page-head">
        <h1>{isNew ? "New idea" : "Edit idea"}</h1>
        <div className="btn-row">
          <Link to="/ideas" className="btn ghost">
            Back
          </Link>
          {!isNew ? (
            <button
              type="button"
              className="btn"
              onClick={() => convert.mutate()}
              disabled={convert.isPending}
            >
              Convert to project
            </button>
          ) : null}
          {!isNew ? (
            <button type="button" className="btn danger" onClick={() => setDeleteOpen(true)}>
              Delete
            </button>
          ) : null}
        </div>
      </div>

      <div className="field">
        <label htmlFor="idea-title">Title</label>
        <input id="idea-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      {!isNew && ideaId != null ? (
        <div className="field">
          <label>Tags</label>
          <TagInput entityType="idea" entityId={ideaId} />
        </div>
      ) : (
        <p className="muted">Save the idea to add tags.</p>
      )}

      <div className="field">
        <label>Body (Markdown)</label>
        <MarkdownEditor value={body} onChange={setBody} height={360} />
      </div>

      <div className="btn-row">
        <button type="button" className="btn primary" onClick={() => save.mutate()} disabled={save.isPending}>
          Save
        </button>
      </div>
      {save.isError ? <p role="alert">{(save.error as Error).message}</p> : null}
      {convert.isError ? <p role="alert">{(convert.error as Error).message}</p> : null}

      <ConfirmDialog
        open={deleteOpen}
        title="Delete idea?"
        message="This cannot be undone."
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false);
          remove.mutate();
        }}
      />
    </div>
  );
}
