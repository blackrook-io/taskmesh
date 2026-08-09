import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Editor } from "@tiptap/react";
import { apiJson } from "../../api/client";
import { findMdReferenceTrigger, type MdRefTrigger } from "../../lib/mdReferenceTrigger";

export type ReferenceHit = {
  entityType: string;
  id: number;
  number: number;
  title: string;
  referenceId: string;
  href: string;
  projectId: number | null;
};

type Props = {
  editor: Editor | null;
  enabled: boolean;
};

function caretCoords(editor: Editor): { top: number; left: number } | null {
  const { view } = editor;
  const sel = view.state.selection;
  try {
    const coords = view.coordsAtPos(sel.from);
    return {
      top: coords.bottom + 4,
      left: Math.min(coords.left, window.innerWidth - 240),
    };
  } catch {
    return null;
  }
}

export function MarkdownReferenceSuggest({ editor, enabled }: Props) {
  const listId = useId();
  const [trigger, setTrigger] = useState<MdRefTrigger | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor || !enabled) {
      setTrigger(null);
      return;
    }

    const refresh = () => {
      const { from } = editor.state.selection;
      if (!editor.state.selection.empty) {
        setTrigger(null);
        return;
      }
      const next = findMdReferenceTrigger(editor.state.doc, from);
      setTrigger(next);
      setCoords(next ? caretCoords(editor) : null);
      setActive(0);
    };

    editor.on("selectionUpdate", refresh);
    editor.on("update", refresh);
    refresh();
    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("update", refresh);
    };
  }, [editor, enabled]);

  const searchKey =
    trigger?.kind === "entity"
      ? `entity:${trigger.entityType}:${trigger.query}`
      : trigger?.kind === "user"
        ? `user:${trigger.query}`
        : "";

  const suggestQuery = useQuery({
    queryKey: ["md-reference-search", searchKey],
    enabled: Boolean(trigger) && searchKey.length > 0,
    queryFn: async () => {
      if (!trigger) return [] as ReferenceHit[];
      if (trigger.kind === "user") {
        const res = await apiJson<{ data: ReferenceHit[] }>(
          `/api/v1/references/search?type=user&q=${encodeURIComponent(trigger.query)}`,
        );
        return res.data;
      }
      const q = trigger.token;
      const res = await apiJson<{ data: ReferenceHit[] }>(
        `/api/v1/references/search?type=${encodeURIComponent(trigger.entityType)}&q=${encodeURIComponent(q)}`,
      );
      return res.data;
    },
  });

  const hits = suggestQuery.data ?? [];

  function applyHit(hit: ReferenceHit) {
    if (!editor || !trigger) return;
    const label =
      trigger.kind === "user"
        ? `@${hit.title}`
        : `[${hit.referenceId}] ${hit.title}`;
    const from = trigger.from;
    const to = trigger.to;
    const safeHref = hit.href.replace(/"/g, "&quot;");
    const safeLabel = label
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    // HTML so bracket labels round-trip through Markdown (`[T0010] Title` breaks MD link syntax).
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .insertContentAt(from, `<a href="${safeHref}">${safeLabel}</a>&nbsp;`)
      .run();
    setTrigger(null);
  }

  useEffect(() => {
    if (!editor || !trigger) return;

    const onKey = (event: KeyboardEvent) => {
      if (!trigger) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setTrigger(null);
        return;
      }
      if (hits.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((i) => (i + 1) % hits.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((i) => (i - 1 + hits.length) % hits.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applyHit(hits[active]!);
      }
    };

    // Capture so we beat TipTap hard-break / default Enter.
    const dom = editor.view.dom;
    dom.addEventListener("keydown", onKey, true);
    return () => dom.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, trigger, hits, active]);

  if (!enabled || !trigger || !coords) return null;

  return (
    <div
      ref={rootRef}
      className="md-ref-suggest"
      style={{ top: coords.top, left: coords.left, position: "fixed" }}
      role="listbox"
      id={listId}
    >
      {suggestQuery.isFetching ? (
        <div className="md-ref-suggest__empty muted">Searching…</div>
      ) : hits.length === 0 ? (
        <div className="md-ref-suggest__empty muted">No matches</div>
      ) : (
        <ul className="md-ref-suggest__list">
          {hits.map((hit, i) => (
            <li key={`${hit.entityType}-${hit.id}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={`md-ref-suggest__item${i === active ? " is-active" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyHit(hit);
                }}
              >
                {trigger.kind === "user" ? (
                  <>
                    <span className="muted">{hit.referenceId}</span> {hit.title}
                  </>
                ) : (
                  <>
                    <span className="muted">{hit.referenceId}</span> {hit.title}
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
