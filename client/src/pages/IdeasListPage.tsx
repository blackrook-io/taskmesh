import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiJson } from "../api/client";
import type { Idea } from "../types";

export function IdeasListPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["ideas"],
    queryFn: async () => {
      const res = await apiJson<{ data: Idea[] }>("/api/v1/ideas");
      return res.data;
    },
  });

  if (isLoading) return <p className="muted">Loading ideas…</p>;
  if (error) return <p role="alert">{(error as Error).message}</p>;

  return (
    <div>
      <div className="page-head">
        <h1>Ideas</h1>
        <Link to="/ideas/new" className="btn primary">
          New idea
        </Link>
      </div>
      <div className="grid">
        {(data ?? []).map((idea) => (
          <Link key={idea.id} to={`/ideas/${idea.id}`} className="card" style={{ textDecoration: "none" }}>
            <h3>{idea.title}</h3>
            <p className="muted">Updated {new Date(idea.updatedAt).toLocaleString()}</p>
          </Link>
        ))}
      </div>
      {data?.length === 0 ? <p className="muted">No ideas yet.</p> : null}
    </div>
  );
}
