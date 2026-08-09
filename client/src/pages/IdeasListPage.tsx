import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiJson } from "../api/client";
import { formatEntityRef } from "../lib/entityRef";
import type { Idea, Tag } from "../types";

type IdeaWithTags = Idea & { tags: Tag[] };

export function IdeasListPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sort = searchParams.get("sort") ?? "date";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const [pendingOpen, setPendingOpen] = useState<number | null>(null);

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
      onDoubleClick={() => navigate(`/ideas/${idea.id}`)}
      onClick={() => setPendingOpen(idea.id)}
    >
      <span className="ideas-list-row__title">
        <span className="muted">{formatEntityRef("idea", idea.number)} </span>
        {idea.title}
      </span>
      <span className="ideas-list-row__tags">
        {idea.tags.map((t) => (
          <span key={t.id} className="chip" style={{ background: t.color ?? undefined }}>
            {t.name}
          </span>
        ))}
      </span>
      <span className="ideas-list-row__date muted">
        {new Date(idea.createdAt).toLocaleDateString()}
      </span>
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
        <div className="ideas-list-header">
          <span>Title</span>
          <span>Tags</span>
          <span>Created</span>
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
    </div>
  );
}
