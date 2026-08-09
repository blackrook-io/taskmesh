import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../../api/client";
import type { EntityType } from "../../lib/entityType";
import type { Tag } from "../../types";
import { TagChip } from "./TagChip";

const MAX_VISIBLE = 3;

type Props = {
  entityType: EntityType;
  entityId: number;
  className?: string;
};

export function RowTagChips({ entityType, entityId, className }: Props) {
  const { data: tags } = useQuery({
    queryKey: ["taggings", entityType, entityId],
    queryFn: async () => {
      const res = await apiJson<{ data: Tag[] }>(
        `/api/v1/taggings?entityType=${encodeURIComponent(entityType)}&entityId=${entityId}`,
      );
      return res.data;
    },
  });

  if (!tags || tags.length === 0) return null;

  const visible = tags.slice(0, MAX_VISIBLE);
  const overflow = tags.length - visible.length;
  const overflowNames =
    overflow > 0 ? tags.slice(MAX_VISIBLE).map((t) => t.name).join(", ") : "";

  return (
    <span
      className={`row-tag-chips${className ? ` ${className}` : ""}`}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {visible.map((tag) => (
        <TagChip key={tag.id} tag={tag} removable={false} className="row-tag-chips__chip" />
      ))}
      {overflow > 0 ? (
        <span className="row-tag-chips__more muted" title={overflowNames}>
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
