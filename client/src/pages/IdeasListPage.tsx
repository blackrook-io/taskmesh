import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiJson } from "../api/client";
import { ListViewHeaderMenu, type ListViewHeaderMenuState } from "../components/shared/ListViewHeaderMenu";
import { ListViewPersonalizeModal } from "../components/shared/ListViewPersonalizeModal";
import { formatEntityRef } from "../lib/entityRef";
import {
  buildIdeasListGridTemplate,
  formatListDate,
  type ResolvedListColumn,
} from "../lib/listViewColumns";
import { useListViewColumns } from "../lib/useListViewColumns";
import type { Idea, Tag } from "../types";

type IdeaWithTags = Idea & { tags: Tag[] };

function renderIdeaCell(col: ResolvedListColumn, idea: IdeaWithTags, numberVisible: boolean) {
  switch (col.fieldKey) {
    case "title":
      return (
        <span key="title" className="ideas-list-row__title">
          {!numberVisible ? (
            <span className="muted">{formatEntityRef("idea", idea.number)} </span>
          ) : null}
          {idea.title}
        </span>
      );
    case "tags":
      return (
        <span key="tags" className="ideas-list-row__tags">
          {idea.tags.map((t) => (
            <span key={t.id} className="chip" style={{ background: t.color ?? undefined }}>
              {t.name}
            </span>
          ))}
        </span>
      );
    case "createdAt":
      return (
        <span key="createdAt" className="ideas-list-row__date muted">
          {new Date(idea.createdAt).toLocaleDateString()}
        </span>
      );
    case "updatedAt":
      return (
        <span key="updatedAt" className="ideas-list-row__date muted">
          {formatListDate(idea.updatedAt)}
        </span>
      );
    case "number":
      return (
        <span key="number" className="muted">
          {formatEntityRef("idea", idea.number)}
        </span>
      );
    case "assignee":
      return (
        <span key="assignee" className="muted" title={idea.assignee?.displayName}>
          {idea.assignee?.displayName ?? "—"}
        </span>
      );
    default:
      return <span key={col.fieldKey} />;
  }
}

export function IdeasListPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sort = searchParams.get("sort") ?? "date";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const [pendingOpen, setPendingOpen] = useState<number | null>(null);
  const [headerMenu, setHeaderMenu] = useState<ListViewHeaderMenuState>(null);
  const [personalizeOpen, setPersonalizeOpen] = useState(false);
  const [personalizeError, setPersonalizeError] = useState<string | null>(null);
  const {
    visibleColumns,
    personalizeRows,
    save: saveListCols,
    reset: resetListCols,
  } = useListViewColumns("ideas", "ideas");
  const gridTemplate = useMemo(
    () => buildIdeasListGridTemplate(visibleColumns),
    [visibleColumns],
  );
  const numberVisible = visibleColumns.some((c) => c.fieldKey === "number");

  const { data, isLoading, error } = useQuery({
    queryKey: ["ideas", "with-tags"],
    queryFn: async () => {
      const res = await apiJson<{ data: Idea[] }>("/api/v1/ideas");
      const ideas = res.data;
      const tagged: IdeaWithTags[] = [];
      for (const idea of ideas) {
        const tagsRes = await apiJson<{ data: Tag[] }>(
          `/api/v1/taggings?entityType=idea&entityId=${idea.id}`,
        );
        tagged.push({ ...idea, tags: tagsRes.data });
      }
      return tagged;
    },
  });

  const sorted = useMemo(() => {
    const list = [...(data ?? [])];
    const dir = order === "asc" ? 1 : -1;
    if (sort === "title") {
      list.sort((a, b) => a.title.localeCompare(b.title) * dir);
    } else if (sort === "tag") {
      list.sort((a, b) => {
        const ta = a.tags.map((t) => t.name).sort().join(",") || "\uffff";
        const tb = b.tags.map((t) => t.name).sort().join(",") || "\uffff";
        return ta.localeCompare(tb) * dir || a.title.localeCompare(b.title);
      });
    } else {
      list.sort(
        (a, b) =>
          (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir ||
          a.id - b.id,
      );
    }
    return list;
  }, [data, sort, order]);

  const grouped =
    sort === "tag"
      ? (() => {
          const map = new Map<string, IdeaWithTags[]>();
          for (const idea of sorted) {
            const keys =
              idea.tags.length === 0
                ? ["(untagged)"]
                : idea.tags.map((t) => t.name).sort();
            for (const key of keys) {
              const arr = map.get(key) ?? [];
              arr.push(idea);
              map.set(key, arr);
            }
          }
          return [...map.entries()];
        })()
      : null;

  if (isLoading) return <p className="muted">Loading ideas…</p>;
  if (error) return <p role="alert">{(error as Error).message}</p>;

  const renderRow = (idea: IdeaWithTags) => (
    <div
      key={idea.id}
      className="ideas-list-row"
      style={{ gridTemplateColumns: gridTemplate }}
      onDoubleClick={() => navigate(`/ideas/${idea.id}`)}
      onClick={() => setPendingOpen(idea.id)}
    >
      {visibleColumns.map((col) => renderIdeaCell(col, idea, numberVisible))}
      <Link
        to={`/ideas/${idea.id}`}
        className="btn small ghost"
        onClick={(e) => e.stopPropagation()}
      >
        Open
      </Link>
    </div>
  );

  return (
    <div>
      <div className="page-head">
        <h1>Ideas</h1>
        <Link to="/ideas/new" className="btn primary">
          New idea
        </Link>
      </div>
      <div className="ideas-list">
        <div
          className="ideas-list-header"
          style={{ gridTemplateColumns: gridTemplate }}
          onContextMenu={(e) => {
            e.preventDefault();
            setHeaderMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          {visibleColumns.map((col) => (
            <span key={col.fieldKey}>{col.label}</span>
          ))}
          <span />
        </div>
        {grouped
          ? grouped.map(([tagName, ideas]) => (
              <div key={tagName} className="ideas-list-group">
                <div className="ideas-list-group__title">{tagName}</div>
                {ideas.map(renderRow)}
              </div>
            ))
          : sorted.map(renderRow)}
      </div>
      {sorted.length === 0 ? <p className="muted">No ideas yet.</p> : null}
      {pendingOpen != null ? (
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
          Double-click a row to open · or use Open
        </p>
      ) : null}
      <ListViewHeaderMenu
        menu={headerMenu}
        onClose={() => setHeaderMenu(null)}
        onPersonalize={() => {
          setPersonalizeError(null);
          setPersonalizeOpen(true);
        }}
      />
      <ListViewPersonalizeModal
        open={personalizeOpen}
        title="Personalize ideas list"
        rows={personalizeRows}
        saving={saveListCols.isPending}
        resetting={resetListCols.isPending}
        error={personalizeError}
        onClose={() => setPersonalizeOpen(false)}
        onSave={(columns) => {
          setPersonalizeError(null);
          saveListCols.mutate(columns, {
            onSuccess: () => setPersonalizeOpen(false),
            onError: (err) => setPersonalizeError((err as Error).message),
          });
        }}
        onReset={() => {
          setPersonalizeError(null);
          resetListCols.mutate(undefined, {
            onSuccess: () => setPersonalizeOpen(false),
            onError: (err) => setPersonalizeError((err as Error).message),
          });
        }}
      />
    </div>
  );
}
