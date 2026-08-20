import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../api/client";
import type { Tag } from "../types";
import { TagChip } from "./shared/TagChip";

type Props = {
  tag: Pick<Tag, "id" | "name" | "color"> | null;
  onChange: (tag: Pick<Tag, "id" | "name" | "color"> | null) => void;
  disabled?: boolean;
};

export function GroupAutoTagPicker({ tag, onChange, disabled }: Props) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const suggestQ = query.trim();
  const suggestQuery = useQuery({
    queryKey: ["tags-suggest", suggestQ],
    enabled: suggestQ.length >= 3,
    queryFn: async () => {
      const res = await apiJson<{ data: Tag[] }>(`/api/v1/tags?q=${encodeURIComponent(suggestQ)}`);
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

  const pick = (next: Tag) => {
    onChange(next);
    setQuery("");
    setOpen(false);
    setError(null);
  };

  const createAndPick = async () => {
    const name = suggestQ;
    if (name.length < 1) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiJson<{ data: Tag }>("/api/v1/tags", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      pick(res.data);
    } catch (err) {
      const message = (err as Error).message;
      if (/already exists|conflict/i.test(message)) {
        const found = (suggestQuery.data ?? []).find(
          (t) => t.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        );
        if (found) {
          pick(found);
          setBusy(false);
          return;
        }
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tag-input group-auto-tag" ref={rootRef}>
      {tag ? (
        <div className="tag-input__chips">
          <TagChip tag={tag} onRemove={disabled ? undefined : () => onChange(null)} />
        </div>
      ) : (
        <div className="tag-input__field-wrap">
          <input
            id={inputId}
            className="tag-input__field"
            value={query}
            disabled={disabled || busy}
            placeholder="Type 3+ letters to pick or create a tag"
            aria-label="Auto-tag"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void createAndPick();
              }
            }}
          />
          {open && suggestQ.length >= 3 ? (
            <ul className="tag-input__suggest" role="listbox">
              {(suggestQuery.data ?? []).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="tag-input__suggest-item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(t)}
                  >
                    {t.name}
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="tag-input__suggest-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void createAndPick()}
                  disabled={busy}
                >
                  Use “{suggestQ}”
                </button>
              </li>
            </ul>
          ) : null}
        </div>
      )}
      {error ? <p className="tag-input__error">{error}</p> : null}
    </div>
  );
}
