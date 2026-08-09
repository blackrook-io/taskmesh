import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "../../api/client";

export type TaskDescriptionTemplate = {
  id: number;
  name: string;
  body: string;
  projectId: number | null;
  isGlobal: boolean;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  projectId: number | null;
  description: string;
  onApply: (body: string) => void;
};

export function TaskDescriptionTemplatesMenu({
  projectId,
  description,
  onApply,
}: Props) {
  const qc = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasDescription = description.trim().length > 0;
  const queryKey = ["task-description-templates", projectId] as const;

  const templatesQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const qs =
        projectId == null
          ? "projectId=null"
          : `projectId=${encodeURIComponent(String(projectId))}`;
      const res = await apiJson<{ data: TaskDescriptionTemplate[] }>(
        `/api/v1/task-description-templates?${qs}`,
      );
      return res.data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiJson<{ data: TaskDescriptionTemplate }>(
        "/api/v1/task-description-templates",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            body: description,
            projectId,
          }),
        },
      );
      return res.data;
    },
    onSuccess: async () => {
      setError(null);
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ["task-description-templates"] });
      await qc.invalidateQueries({ queryKey: ["admin", "task-description-templates"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const templates = templatesQuery.data ?? [];

  const saveCurrent = () => {
    if (!hasDescription || saveMutation.isPending) return;
    const name = window.prompt("Template name", "");
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Template name is required");
      return;
    }
    saveMutation.mutate(trimmed);
  };

  return (
    <div className="task-desc-templates" ref={rootRef}>
      <button
        type="button"
        className={`btn ghost small task-desc-templates__trigger${open ? " is-active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setError(null);
          setOpen((o) => !o);
        }}
      >
        Templates
      </button>
      {open ? (
        <div className="task-desc-templates__menu" role="menu">
          {templatesQuery.isLoading ? (
            <div className="task-desc-templates__empty muted">Loading…</div>
          ) : templates.length === 0 ? (
            <div className="task-desc-templates__empty muted">No templates yet</div>
          ) : (
            templates.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                className="task-desc-templates__item"
                disabled={hasDescription}
                title={
                  hasDescription
                    ? "Clear the description to apply a template"
                    : t.isGlobal
                      ? `${t.name} (Global)`
                      : t.name
                }
                onClick={() => {
                  if (hasDescription) return;
                  onApply(t.body);
                  setOpen(false);
                }}
              >
                <span>{t.name}</span>
                {t.isGlobal ? <span className="muted">Global</span> : null}
              </button>
            ))
          )}
          <div className="task-desc-templates__sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="task-desc-templates__item"
            disabled={!hasDescription || saveMutation.isPending}
            title={
              hasDescription
                ? "Save the current description as a template"
                : "Write a description before saving a template"
            }
            onClick={saveCurrent}
          >
            {saveMutation.isPending ? "Saving…" : "Save Template…"}
          </button>
          {error ? (
            <div className="task-desc-templates__error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
