import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiJson } from "../api/client";
import type { Project } from "../types";

export function ProjectsListPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await apiJson<{ data: Project[] }>("/api/v1/projects");
      return res.data;
    },
  });

  if (isLoading) return <p className="muted">Loading projects…</p>;
  if (error) return <p role="alert">{(error as Error).message}</p>;

  return (
    <div>
      <div className="page-head">
        <h1>Projects</h1>
        <Link to="/projects/new" className="btn primary">
          New project
        </Link>
      </div>
      <div className="grid">
        {(data ?? []).map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="card" style={{ textDecoration: "none" }}>
            <h3>{p.name}</h3>
            <p className="muted">
              {p.status} · updated {new Date(p.updatedAt).toLocaleString()}
            </p>
          </Link>
        ))}
      </div>
      {data?.length === 0 ? <p className="muted">No projects yet.</p> : null}
    </div>
  );
}
