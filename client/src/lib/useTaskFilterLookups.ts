import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../api/client";
import type { Project, Tag } from "../types";
import type { FilterMatchContext } from "./taskListFilter";

export type FilterTagOption = Pick<Tag, "id" | "name">;

type TaggingRow = Tag & { entityId: number };

export function useTaskFilterLookups(opts: { includeProjects: boolean }): {
  tags: FilterTagOption[];
  projects: Project[];
  filterCtx: FilterMatchContext;
} {
  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: async () => {
      const res = await apiJson<{ data: Tag[] }>("/api/v1/tags");
      return res.data;
    },
  });

  const taggingsQuery = useQuery({
    queryKey: ["taggings", "task"],
    queryFn: async () => {
      const res = await apiJson<{ data: TaggingRow[] }>("/api/v1/taggings?entityType=task");
      return res.data;
    },
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    enabled: opts.includeProjects,
    queryFn: async () => {
      const res = await apiJson<{ data: Project[] }>("/api/v1/projects");
      return res.data;
    },
  });

  const tags = tagsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];

  const tagNames = useMemo(
    () => new Map(tags.map((t) => [t.id, t.name])),
    [tags],
  );

  const taskTags = useMemo(() => {
    const map = new Map<number, { id: number; name: string }[]>();
    for (const row of taggingsQuery.data ?? []) {
      const list = map.get(row.entityId) ?? [];
      list.push({ id: row.id, name: row.name });
      map.set(row.entityId, list);
    }
    return map;
  }, [taggingsQuery.data]);

  const projectNames = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  const filterCtx = useMemo(
    (): FilterMatchContext => ({
      tagNames,
      taskTags,
      projectNames: opts.includeProjects ? projectNames : undefined,
    }),
    [tagNames, taskTags, projectNames, opts.includeProjects],
  );

  return { tags, projects, filterCtx };
}
