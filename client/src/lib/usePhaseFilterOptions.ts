import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../api/client";
import type { Project, ProjectPhase } from "../types";

export type PhaseFilterOption = ProjectPhase & { label: string };

export function usePhaseFilterOptions(projectId?: number): {
  phases: PhaseFilterOption[];
  phaseNames: Map<number, string>;
} {
  const scoped = projectId != null;
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    enabled: !scoped,
    queryFn: async () => {
      const res = await apiJson<{ data: Project[] }>("/api/v1/projects");
      return res.data;
    },
  });

  const oneQuery = useQuery({
    queryKey: ["project-phases", projectId],
    enabled: scoped,
    queryFn: async () => {
      const res = await apiJson<{ data: ProjectPhase[] }>(
        `/api/v1/projects/${projectId}/phases`,
      );
      return res.data;
    },
  });

  const projectIdsKey = (projectsQuery.data ?? []).map((p) => p.id).join(",");
  const allQuery = useQuery({
    queryKey: ["project-phases", "all", projectIdsKey],
    enabled: !scoped && projectsQuery.data != null,
    queryFn: async () => {
      const projects = projectsQuery.data ?? [];
      const nested = await Promise.all(
        projects.map(async (p) => {
          const res = await apiJson<{ data: ProjectPhase[] }>(
            `/api/v1/projects/${p.id}/phases`,
          );
          return res.data.map((ph) => ({ ...ph, label: `${p.name} — ${ph.name}` }));
        }),
      );
      return nested.flat();
    },
  });

  const phases: PhaseFilterOption[] = scoped
    ? (oneQuery.data ?? []).map((p) => ({ ...p, label: p.name }))
    : (allQuery.data ?? []);

  const phaseNames = useMemo(
    () => new Map(phases.map((p) => [p.id, p.label])),
    [phases],
  );

  return { phases, phaseNames };
}
