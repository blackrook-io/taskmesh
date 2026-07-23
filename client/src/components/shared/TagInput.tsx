import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "../../api/client";
import type { EntityType } from "../../lib/entityType";
import type { Tag } from "../../types";
import { TagChip } from "./TagChip";

type Props = {
  entityType: EntityType;
  entityId: number;
  disabled?: boolean;
  className?: string;
};

export function TagInput({ entityType, entityId, disabled, className }: Props) {
  const qc = useQueryClient();
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const tagsKey = ["taggings", entityType, entityId] as const;

  const tagsQuery = useQuery({
    queryKey: tagsKey,
    queryFn: async () => {
      const res = await apiJson<{ data: Tag[] }>(
        `/api/v1/taggings?entityType=${encodeURIComponent(entityType)}&entityId=${entityId}`,
      );
      return res.data;
    },
  });

  const suggestQ = query.trim();
  const suggestQuery = useQuery({
    queryKey: ["tags-suggest", suggestQ],
    enabled: suggestQ.length >= 3,
    queryFn: async () => {
      const res = await apiJson<{ data: Tag[] }>(
        `/api/v1/tags?q=${encodeURIComponent(suggestQ)}`,
      );
      return res.data;
    },
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: tagsKey });
    void qc.invalidateQueries({ queryKey: ["tags"] });
    void qc.invalidateQueries({ queryKey: ["tags-suggest"] });
    void qc.invalidateQueries({ queryKey: ["search"] });
  };

  const attach = useMutation({
    mutationFn: async (body: { tagId?: number; name?: string }) => {
      const res = await apiJson<{ data: Tag }>("/api/v1/taggings", {
        method: "POST",
        body: JSON.stringify({ entityType, entityId, ...body }),
      });
      return res.data;
    },
    onSuccess: () => {
      setQuery("");
      setOpen(false);
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const detach = useMutation({
    mutationFn: async (tagId: number) => {
      await apiJson("/api/v1/taggings", {
        method: "DELETE",
        body: JSON.stringify({ tagId, entityType, entityId }),
      });
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const recolor = useMutation({
    mutationFn: async ({ tagId, color }: { tagId: number; color: string | null }) => {
      const res = await apiJson<{ data: Tag }>(`/api/v1/tags/${tagId}`, {
        method: "PATCH",
        body: JSON.stringify({ color }),
      });
      return res.data;
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const attached = tagsQuery.data ?? [];
  const attachedIds = new Set(attached.map((t) => t.id));
  const suggestions = (suggestQuery.data ?? []).filter((t) => !attachedIds.has(t.id));

  const commit = () => {
    const name = query.trim();
    if (!name || disabled || attach.isPending) return;
    const exact = suggestions.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (exact) {
      attach.mutate({ tagId: exact.id });
      return;
    }
    const already = attached.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (already) {
      setQuery("");
      setOpen(false);
      return;
    }
    attach.mutate({ name });
  };

  return (
    <div className={`tag-input${className ? ` ${className}` : ""}`} ref={rootRef}>
      <div className="tag-input__chips">
        {attached.map((tag) => (
          <TagChip
            key={tag.id}
            tag={tag}
            onRemove={
              disabled
                ? undefined
                : () => {
                    detach.mutate(tag.id);
                  }
            }
            onColorChange={
              disabled
                ? undefined
                : (color) => {
                    recolor.mutate({ tagId: tag.id, color });
                  }
            }
          />
        ))}
        <div className="tag-input__field-wrap">
          <label className="sr-only" htmlFor={inputId}>
            Add tag
          </label>
          <input
            id={inputId}
            type="text"
            className="tag-input__field"
            placeholder="Add tag…"
            value={query}
            disabled={disabled || attach.isPending}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                setOpen(false);
              } else if (e.key === "ArrowDown" && suggestions.length > 0) {
                e.preventDefault();
                listRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
              }
            }}
          />
          {open && suggestQ.length >= 3 ? (
            <ul className="tag-input__suggest" ref={listRef} role="listbox">
              {suggestQuery.isFetching ? (
                <li className="tag-input__suggest-empty muted">Searching…</li>
              ) : suggestions.length === 0 ? (
                <li className="tag-input__suggest-empty muted">
                  No matches — press Enter to create “{suggestQ}”
                </li>
              ) : (
                suggestions.map((t) => (
                  <li key={t.id} role="option">
                    <button
                      type="button"
                      className="tag-input__suggest-item"
                      onClick={() => attach.mutate({ tagId: t.id })}
                    >
                      <TagChip tag={t} removable={false} />
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>
      </div>
      {suggestQ.length > 0 && suggestQ.length < 3 ? (
        <p className="tag-input__hint muted">Type at least 3 characters to search existing tags</p>
      ) : null}
      {tagsQuery.isError ? (
        <p className="tag-input__error" role="alert">
          {(tagsQuery.error as Error).message}
        </p>
      ) : null}
      {error ? (
        <p className="tag-input__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
