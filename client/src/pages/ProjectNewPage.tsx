import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { apiJson } from "../api/client";
import type { Project } from "../types";

export function ProjectNewPage() {
  const [name, setName] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: Project }>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      return res.data;
    },
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${p.id}`);
    },
  });

  return (
    <div>
      <div className="page-head">
        <h1>New project</h1>
        <Link to="/projects" className="btn ghost">
          Back
        </Link>
      </div>
      <div className="field">
        <label htmlFor="p-name">Name</label>
        <input id="p-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <button type="button" className="btn primary" onClick={() => create.mutate()} disabled={create.isPending || !name.trim()}>
        Create
      </button>
      {create.isError ? <p role="alert">{(create.error as Error).message}</p> : null}
    </div>
  );
}
