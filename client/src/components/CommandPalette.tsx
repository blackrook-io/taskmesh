import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiJson } from "../api/client";
import { loadRecentNav, pushRecentNav } from "../lib/recentNav";
import type { SearchResults } from "../types";

type Props = {
  open: boolean;
  onClose: () => void;
};

type PaletteItem = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  path: string;
  /** Special client action instead of navigation */
  action?: "open-assistant";
};

const STATIC_COMMANDS: PaletteItem[] = [
  { id: "nav-home", group: "Go to", label: "Home", path: "/" },
  { id: "nav-ideas", group: "Go to", label: "Ideas", path: "/ideas" },
  { id: "nav-projects", group: "Go to", label: "Projects", path: "/projects" },
  { id: "nav-todos", group: "Go to", label: "To Dos", path: "/todos" },
  { id: "nav-search", group: "Go to", label: "Search page", path: "/search" },
  {
    id: "open-assistant",
    group: "Assistant",
    label: "Open assistant",
    hint: "Chat",
    path: "/settings/assistant",
    action: "open-assistant",
  },
  {
    id: "nav-assistant-settings",
    group: "Go to",
    label: "Assistant settings",
    path: "/settings/assistant",
  },
  {
    id: "nav-import-export",
    group: "Go to",
    label: "Import / Export",
    path: "/settings/import-export",
  },
  {
    id: "nav-backups",
    group: "Go to",
    label: "Backups",
    path: "/settings/backups",
  },
  ...(import.meta.env.DEV
    ? [
        {
          id: "nav-playground",
          group: "Go to",
          label: "Playground",
          path: "/dev/playground",
        } satisfies PaletteItem,
      ]
    : []),
  { id: "new-idea", group: "Create", label: "New idea", path: "/ideas/new" },
  { id: "new-project", group: "Create", label: "New project", path: "/projects/new" },
];

function flattenSearch(data: SearchResults): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const i of data.ideas) {
    out.push({
      id: `idea-${i.id}`,
      group: "Ideas",
      label: i.title,
      path: `/ideas/${i.id}`,
    });
  }
  for (const p of data.projects) {
    out.push({
      id: `project-${p.id}`,
      group: "Projects",
      label: p.name,
      path: `/projects/${p.id}`,
    });
  }
  for (const t of data.tasks) {
    out.push({
      id: `task-${t.id}`,
      group: "Tasks",
      label: t.title,
      hint: `Project #${t.projectId}`,
      path: `/projects/${t.projectId}?tab=tasks`,
    });
  }
  for (const d of data.documents) {
    out.push({
      id: `doc-${d.id}`,
      group: "Documents",
      label: d.title,
      hint: `Project #${d.projectId}`,
      path: `/projects/${d.projectId}?tab=documents`,
    });
  }
  return out;
}

export function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchHits, setSearchHits] = useState<PaletteItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [recentTick, setRecentTick] = useState(0);

  const recentItems = useMemo((): PaletteItem[] => {
    void recentTick;
    return loadRecentNav().map((r, i) => ({
      id: `recent-${i}-${r.path}`,
      group: "Recent",
      label: r.label,
      hint: r.path,
      path: r.path,
    }));
  }, [recentTick]);

  const items = useMemo(() => {
    const q = query.trim();
    if (q.length >= 1) {
      const filteredStatic = STATIC_COMMANDS.filter((c) =>
        c.label.toLowerCase().includes(q.toLowerCase()),
      );
      return [...searchHits, ...filteredStatic];
    }
    return [...recentItems, ...STATIC_COMMANDS];
  }, [query, searchHits, recentItems]);

  useEffect(() => {
    setActiveIndex(0);
  }, [items.length, query]);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setSearchHits([]);
    setRecentTick((n) => n + 1);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 1) {
      setSearchHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void apiJson<{ data: SearchResults }>(
        `/api/v1/search?q=${encodeURIComponent(q)}`,
      )
        .then((res) => {
          if (!cancelled) setSearchHits(flattenSearch(res.data));
        })
        .catch(() => {
          if (!cancelled) setSearchHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, open]);

  const go = useCallback(
    (item: PaletteItem) => {
      if (item.action === "open-assistant") {
        onClose();
        window.dispatchEvent(new CustomEvent("taskmesh:open-assistant"));
        return;
      }
      pushRecentNav(item.path, item.label);
      onClose();
      navigate(item.path);
    },
    [navigate, onClose],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const root = listRef.current?.closest(".command-palette");
        if (!root) return;
        const focusable = root.querySelectorAll<HTMLElement>(
          'input, button.command-palette__item, button:not([disabled])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) =>
          items.length === 0 ? 0 : (i - 1 + items.length) % items.length,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = items[activeIndex];
        if (item) go(item);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, items, activeIndex, go]);

  // Keep active row visible
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-palette-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  if (!open) return null;

  let lastGroup = "";

  return (
    <div
      className="command-palette-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="command-palette__title">
          Command palette
        </h2>
        <input
          ref={inputRef}
          className="command-palette__input"
          type="search"
          placeholder="Search or jump to…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-autocomplete="list"
          aria-controls="command-palette-list"
          autoComplete="off"
        />
        <div
          id="command-palette-list"
          className="command-palette__list"
          role="listbox"
          ref={listRef}
        >
          {searching ? <p className="muted command-palette__status">Searching…</p> : null}
          {!searching && items.length === 0 ? (
            <p className="muted command-palette__status">No matches</p>
          ) : null}
          {items.map((item, index) => {
            const showGroup = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {showGroup ? (
                  <div className="command-palette__group" aria-hidden>
                    {item.group}
                  </div>
                ) : null}
                <button
                  type="button"
                  role="option"
                  data-palette-index={index}
                  aria-selected={index === activeIndex}
                  className={`command-palette__item${index === activeIndex ? " is-active" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => go(item)}
                >
                  <span className="command-palette__label">{item.label}</span>
                  {item.hint ? (
                    <span className="command-palette__hint muted">{item.hint}</span>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
        <p className="command-palette__footer muted">
          ↑↓ navigate · Enter open · Esc close
        </p>
      </div>
    </div>
  );
}
