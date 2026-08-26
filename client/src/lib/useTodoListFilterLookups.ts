import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../api/client";
import type { Tag } from "../types";
import {
  entityTagKey,
  type TodoFilterMatchContext,
} from "./todoListFilter";

export type FilterTagOption = Pick<Tag, "id" | "name">;

type TaggingRow = Tag & { entityId: number };

export function useTodoListFilterLookups(): {
  tags: FilterTagOption[];
  filterCtx: TodoFilterMatchContext;
} {
  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: async () => {
      const res = await apiJson<{ data: Tag[] }>("/api/v1/tags");
      return res.data;
    },
  });

  const todoTaggingsQuery = useQuery({
    queryKey: ["taggings", "todo"],
    queryFn: async () => {
      const res = await apiJson<{ data: TaggingRow[] }>("/api/v1/taggings?entityType=todo");
      return res.data;
    },
  });

  const taskTaggingsQuery = useQuery({
    queryKey: ["taggings", "task"],
    queryFn: async () => {
      const res = await apiJson<{ data: TaggingRow[] }>("/api/v1/taggings?entityType=task");
      return res.data;
    },
  });

  const ideaTaggingsQuery = useQuery({
    queryKey: ["taggings", "idea"],
    queryFn: async () => {
      const res = await apiJson<{ data: TaggingRow[] }>("/api/v1/taggings?entityType=idea");
      return res.data;
    },
  });

  const tags = tagsQuery.data ?? [];

  const tagNames = useMemo(() => new Map(tags.map((t) => [t.id, t.name])), [tags]);

  const entityTags = useMemo(() => {
    const map = new Map<string, { id: number; name: string }[]>();
    const add = (entityType: string, rows: TaggingRow[] | undefined) => {
      for (const row of rows ?? []) {
        const key = entityTagKey(entityType, row.entityId);
        const list = map.get(key) ?? [];
        list.push({ id: row.id, name: row.name });
        map.set(key, list);
      }
    };
    add("todo", todoTaggingsQuery.data);
    add("task", taskTaggingsQuery.data);
    add("idea", ideaTaggingsQuery.data);
    return map;
  }, [todoTaggingsQuery.data, taskTaggingsQuery.data, ideaTaggingsQuery.data]);

  const filterCtx = useMemo(
    (): TodoFilterMatchContext => ({ tagNames, entityTags }),
    [tagNames, entityTags],
  );

  return { tags, filterCtx };
}
