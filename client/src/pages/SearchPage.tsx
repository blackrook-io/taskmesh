import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../api/client";
import { TagChip } from "../components/shared/TagChip";
import type { SearchResults, Tag } from "../types";

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initialQ = params.get("q") ?? "";
  const initialTag = params.get("tag") ?? "";
  const [q, setQ] = useState(initialQ);
  const [tagFilter, setTagFilter] = useState(initialTag);

  const activeQ = params.get("q") ?? "";
  const activeTag = params.get("tag") ?? "";
  const hasQuery = Boolean(activeQ || activeTag);

  const searchQuery = useQuery({
    queryKey: ["search", activeQ, activeTag],
    enabled: hasQuery,
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (activeQ) sp.set("q", activeQ);
      if (activeTag) sp.set("tag", activeTag);
      const res = await apiJson<{ data: SearchResults }>(`/api/v1/search?${sp.toString()}`);
      return res.data;
    },
  });

  const allTags = useQuery({
    queryKey: ["tags"],
    queryFn: async () => {
      const res = await apiJson<{ data: Tag[] }>("/api/v1/tags");
      return res.data;
    },
  });

  const totals = useMemo(() => {
    const d = searchQuery.data;
    if (!d) return 0;
    return d.ideas.length + d.projects.length + d.tasks.length + d.documents.length;
  }, [searchQuery.data]);

  const runSearch = (next?: { q?: string; tag?: string }) => {
    const nextQ = next?.q ?? q;
    const nextTag = next?.tag ?? tagFilter;
    const sp = new URLSearchParams();
    if (nextQ.trim()) sp.set("q", nextQ.trim());
    if (nextTag.trim()) sp.set("tag", nextTag.trim());
    setParams(sp);
  };

  return (
    <div>
      <div className="page-head">
        <h1>Search</h1>
      </div>
      <p className="muted">Search titles and bodies, or browse by tag.</p>

      <form
        className="card search-form"
        style={{ marginTop: "1rem" }}
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
      >
        <div className="field">
          <label htmlFor="search-q">Query</label>
          <input
            id="search-q"
            type="search"
            value={q}
            placeholder="Search ideas, projects, tasks, documents…"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="search-tag">Tag filter</label>
          <input
            id="search-tag"
            type="text"
            value={tagFilter}
            placeholder="Exact tag name"
            onChange={(e) => setTagFilter(e.target.value)}
            list="all-tags-list"
          />
          <datalist id="all-tags-list">
            {(allTags.data ?? []).map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
        </div>
        <div className="btn-row">
          <button type="submit" className="btn primary">
            Search
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setQ("");
              setTagFilter("");
              setParams(new URLSearchParams());
            }}
          >
            Clear
          </button>
        </div>
      </form>

      {(allTags.data?.length ?? 0) > 0 ? (
        <section className="card" style={{ marginTop: "1rem" }}>
          <h2>Browse by tag</h2>
          <div className="tag-input__chips" style={{ marginTop: "0.5rem" }}>
            {allTags.data!.map((t) => (
              <button
                key={t.id}
                type="button"
                className="tag-browse-btn"
                onClick={() => {
                  setTagFilter(t.name);
                  runSearch({ tag: t.name, q: q });
                }}
              >
                <TagChip tag={t} removable={false} />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {hasQuery ? (
        <section style={{ marginTop: "1.25rem" }}>
          {searchQuery.isLoading ? <p className="muted">Searching…</p> : null}
          {searchQuery.isError ? (
            <p role="alert">{(searchQuery.error as Error).message}</p>
          ) : null}
          {searchQuery.data ? (
            <>
              <p className="muted">
                {totals} result{totals === 1 ? "" : "s"}
                {searchQuery.data.tag ? (
                  <>
                    {" "}
                    for tag{" "}
                    <TagChip tag={searchQuery.data.tag} removable={false} />
                  </>
                ) : null}
              </p>

              <ResultGroup
                title="Ideas"
                items={searchQuery.data.ideas.map((i) => ({
                  key: i.id,
                  label: i.title,
                  to: `/ideas/${i.id}`,
                }))}
              />
              <ResultGroup
                title="Projects"
                items={searchQuery.data.projects.map((p) => ({
                  key: p.id,
                  label: p.name,
                  to: `/projects/${p.id}`,
                }))}
              />
              <ResultGroup
                title="Tasks"
                items={searchQuery.data.tasks.map((t) => ({
                  key: t.id,
                  label: t.title,
                  to: `/projects/${t.projectId}`,
                  hint: `project #${t.projectId}`,
                }))}
              />
              <ResultGroup
                title="Documents"
                items={searchQuery.data.documents.map((d) => ({
                  key: d.id,
                  label: d.title,
                  to: `/projects/${d.projectId}`,
                  hint: `project #${d.projectId}`,
                }))}
              />
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function ResultGroup({
  title,
  items,
}: {
  title: string;
  items: { key: number; label: string; to: string; hint?: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="card" style={{ marginTop: "0.75rem" }}>
      <h2>
        {title}{" "}
        <span className="muted" style={{ fontWeight: 400, fontSize: "0.9rem" }}>
          ({items.length})
        </span>
      </h2>
      <ul className="search-results">
        {items.map((item) => (
          <li key={item.key}>
            <Link to={item.to}>{item.label}</Link>
            {item.hint ? <span className="muted"> — {item.hint}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
